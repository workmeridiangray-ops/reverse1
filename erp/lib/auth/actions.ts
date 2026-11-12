"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { withSystem, withTenantSystem } from "../db";
import { fail, type ActionResult } from "../actions";
import { hashPassword, verifyPassword, passwordProblem, newToken, sha256 } from "./password";
import { createSession, setSessionCookie, clearSessionCookie, getCtx, requireUser, revokeUserSessions, COOKIE } from "./session";
import { cookies } from "next/headers";
import { newSecret, verifyTotp, otpauthUri } from "./totp";
import { UserError } from "../errors";
import { queueEmail } from "../email";
import { audit } from "../audit";
import { provisionTenant } from "../tenancy";
import { startTrial, assertEntitled } from "../billing";
import { env } from "../env";
import { randomBytes } from "node:crypto";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const slugify = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
const ip = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

export async function signupAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const d = z.object({
      name: z.string().min(2, "Enter your name").max(80), email: z.string().email("Enter a valid email"),
      company: z.string().min(2, "Enter your company name").max(100), password: z.string(), agree: z.literal("on", { errorMap: () => ({ message: "Please accept the terms" }) }),
    }).parse({ name: s(f, "name"), email: s(f, "email").toLowerCase(), company: s(f, "company"), password: String(f.get("password") ?? ""), agree: f.get("agree") });
    const pw = passwordProblem(d.password); if (pw) throw new UserError(pw, { password: pw });
    const hash = await hashPassword(d.password);
    await withSystem(async (db) => {
      if ((await db.query("select 1 from users where lower(email)=$1", [d.email])).rowCount) throw new UserError("An account with this email already exists. Sign in or reset your password.", { email: "Already registered" });
      const u = (await db.query("insert into users(email,name,password_hash) values ($1,$2,$3) returning id", [d.email, d.name, hash])).rows[0].id;
      let slug = slugify(d.company);
      if ((await db.query("select 1 from tenants where slug=$1", [slug])).rowCount) slug += "-" + randomBytes(2).toString("hex");
      const t = (await db.query("insert into tenants(name,slug,legal_name) values ($1,$2,$1) returning id", [d.company, slug])).rows[0].id;
      await db.query("select set_config('app.tenant_id', $1, true)", [t]);
      await provisionTenant(db, t, u, d.company);
      await startTrial(db, t);
      const tok = newToken();
      await db.query("insert into auth_tokens(user_id,kind,token_hash,expires_at) values ($1,'verify',$2, now() + interval '2 days')", [u, sha256(tok)]);
      await queueEmail(db, { to: d.email, subject: "Verify your Ledgerline email", text: `Hi ${d.name},\n\nConfirm your email to open your workspace:\n${env.appUrl}/verify?token=${tok}\n\nThe link works for 2 days.` });
      await audit(db, { tenantId: t, actorUserId: u, action: "user.signed_up", entityType: "user", entityId: u });
    });
    return { ok: true, redirectTo: "/verify?sent=1" };
  } catch (e) { return fail(e); }
}

export async function resendVerifyAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const email = s(f, "email").toLowerCase();
    await withSystem(async (db) => {
      const u = (await db.query("select id,name,email_verified_at from users where lower(email)=$1", [email])).rows[0];
      if (u && !u.email_verified_at) {
        const tok = newToken();
        await db.query("insert into auth_tokens(user_id,kind,token_hash,expires_at) values ($1,'verify',$2, now() + interval '2 days')", [u.id, sha256(tok)]);
        await queueEmail(db, { to: email, subject: "Verify your Ledgerline email", text: `Confirm your email:\n${env.appUrl}/verify?token=${tok}` });
      }
    });
    return { ok: true, message: "If that address has an unverified account, a new link is on its way." };
  } catch (e) { return fail(e); }
}

export async function verifyEmailToken(token: string): Promise<"ok" | "invalid"> {
  return withSystem(async (db) => {
    const t = (await db.query("select * from auth_tokens where token_hash=$1 and kind='verify' and used_at is null and expires_at>now() for update", [sha256(token)])).rows[0];
    if (!t) return "invalid";
    await db.query("update auth_tokens set used_at=now() where id=$1", [t.id]);
    await db.query("update users set email_verified_at=coalesce(email_verified_at, now()) where id=$1", [t.user_id]);
    return "ok";
  });
}

export async function loginAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const email = s(f, "email").toLowerCase(), pw = String(f.get("password") ?? "");
    const next = s(f, "next");
    if (!email || !pw) throw new UserError("Enter your email and password.");
    const addr = await ip();
    const res = await withSystem(async (db) => {
      const recent = Number((await db.query("select count(*) c from login_attempts where (lower(email)=$1 or ip=$2) and not ok and created_at > now() - interval '15 minutes'", [email, addr])).rows[0].c);
      if (recent >= 8) throw new UserError("Too many failed attempts. Wait 15 minutes or reset your password.");
      const u = (await db.query("select * from users where lower(email)=$1", [email])).rows[0];
      const good = u ? await verifyPassword(pw, u.password_hash) : (await verifyPassword(pw, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "=="), false);
      if (!u || !good) { await db.query("insert into login_attempts(email,ip,ok) values ($1,$2,false)", [email, addr]); return { err: "Email or password is incorrect." }; }
      if (u.status !== "active") return { err: "This account is suspended. Contact your administrator." };
      if (!u.email_verified_at) return { err: "Verify your email first — check your inbox, or request a new link.", unverified: true };
      await db.query("insert into login_attempts(email,ip,ok) values ($1,$2,true)", [email, addr]);
      await db.query("update users set last_login_at=now() where id=$1", [u.id]);
      const token = await createSession(db, u.id, !u.totp_enabled);
      return { token, mfa: u.totp_enabled };
    });
    if ("err" in res) return { ok: false, error: res.err!, fields: res.unverified ? { email: "Not verified" } : undefined };
    await setSessionCookie(res.token!);
    const safe = next.startsWith("/") && !next.startsWith("//") ? next : "";
    return { ok: true, redirectTo: res.mfa ? `/login/2fa${safe ? `?next=${encodeURIComponent(safe)}` : ""}` : safe || "/workspaces" };
  } catch (e) { return fail(e); }
}

export async function twoFactorAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireUser();
    const code = s(f, "code");
    await withSystem(async (db) => {
      const recent = Number((await db.query("select count(*) c from login_attempts where lower(email)=$1 and not ok and created_at > now() - interval '15 minutes'", ["2fa:" + ctx.user.id])).rows[0].c);
      if (recent >= 8) throw new UserError("Too many attempts. Sign in again in 15 minutes.");
      const u = (await db.query("select totp_secret, recovery_codes from users where id=$1", [ctx.user.id])).rows[0];
      let ok = !!u.totp_secret && verifyTotp(u.totp_secret, code);
      if (!ok) {
        const h = sha256(code.replace(/\s|-/g, "").toLowerCase());
        if (u.recovery_codes.includes(h)) { ok = true; await db.query("update users set recovery_codes = array_remove(recovery_codes, $2) where id=$1", [ctx.user.id, h]); }
      }
      if (!ok) { await db.query("insert into login_attempts(email,ip,ok) values ($1,$2,false)", ["2fa:" + ctx.user.id, await ip()]); throw new UserError("That code is not valid. Check your authenticator app and try again.", { code: "Invalid code" }); }
      await db.query("update sessions set mfa_ok=true where id=$1", [ctx.sessionId]);
    });
    const next = s(f, "next");
    return { ok: true, redirectTo: next.startsWith("/") && !next.startsWith("//") ? next : "/workspaces" };
  } catch (e) { return fail(e); }
}

export async function logoutAction() {
  const t = (await cookies()).get(COOKIE)?.value;
  if (t) await withSystem((db) => db.query("update sessions set revoked_at=now() where token_hash=$1", [sha256(t)]));
  await clearSessionCookie();
}

export async function forgotAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const email = s(f, "email").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new UserError("Enter a valid email.", { email: "Invalid email" });
    await withSystem(async (db) => {
      const recent = Number((await db.query("select count(*) c from auth_tokens t join users u on u.id=t.user_id where lower(u.email)=$1 and t.kind='reset' and t.created_at > now() - interval '1 hour'", [email])).rows[0].c);
      const u = (await db.query("select id from users where lower(email)=$1 and status='active'", [email])).rows[0];
      if (u && recent < 3) {
        const tok = newToken();
        await db.query("insert into auth_tokens(user_id,kind,token_hash,expires_at) values ($1,'reset',$2, now() + interval '1 hour')", [u.id, sha256(tok)]);
        await queueEmail(db, { to: email, subject: "Reset your Ledgerline password", text: `Use this link within one hour to choose a new password:\n${env.appUrl}/reset?token=${tok}\n\nIf you did not ask for this, ignore this email.` });
      }
    });
    return { ok: true, message: "If an account exists for that address, a reset link has been sent. It works for one hour." };
  } catch (e) { return fail(e); }
}

export async function resetAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const token = s(f, "token"), pw = String(f.get("password") ?? "");
    const problem = passwordProblem(pw); if (problem) throw new UserError(problem, { password: problem });
    if (pw !== String(f.get("confirm") ?? "")) throw new UserError("The two passwords do not match.", { confirm: "Does not match" });
    const hash = await hashPassword(pw);
    await withSystem(async (db) => {
      const t = (await db.query("select * from auth_tokens where token_hash=$1 and kind='reset' and used_at is null and expires_at>now() for update", [sha256(token)])).rows[0];
      if (!t) throw new UserError("This reset link has expired or was already used. Request a new one.");
      await db.query("update auth_tokens set used_at=now() where id=$1", [t.id]);
      await db.query("update users set password_hash=$2, email_verified_at=coalesce(email_verified_at, now()), failed_logins=0 where id=$1", [t.user_id, hash]);
      await revokeUserSessions(db, t.user_id);
      await audit(db, { actorUserId: t.user_id, action: "user.password_reset", entityType: "user", entityId: t.user_id });
    });
    return { ok: true, redirectTo: "/login?reset=1" };
  } catch (e) { return fail(e); }
}

// ---------- invitations ----------
export async function acceptInviteAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const token = s(f, "token");
    const ctx = await getCtx();
    const out = await withSystem(async (db) => {
      const inv = (await db.query("select i.*, t.status tstatus from invitations i join tenants t on t.id=i.tenant_id where i.token_hash=$1 for update of i", [sha256(token)])).rows[0];
      if (!inv || inv.status !== "pending" || new Date(inv.expires_at) < new Date()) throw new UserError(inv?.status === "revoked" ? "This invitation was withdrawn by the company." : "This invitation has expired or was already used. Ask the company administrator to send a new one.");
      let user = (await db.query("select * from users where lower(email)=lower($1)", [inv.email])).rows[0];
      if (user) {
        if (!ctx || ctx.user.id !== user.id) throw new UserError("An account already exists for this email. Sign in with it first, then reopen this invitation link.");
      } else {
        const name = s(f, "name"), pw = String(f.get("password") ?? "");
        if (name.length < 2) throw new UserError("Enter your name.", { name: "Required" });
        const problem = passwordProblem(pw); if (problem) throw new UserError(problem, { password: problem });
        user = (await db.query("insert into users(email,name,password_hash,email_verified_at) values ($1,$2,$3,now()) returning *", [inv.email.toLowerCase(), name, await hashPassword(pw)])).rows[0];
      }
      await db.query("select set_config('app.tenant_id', $1, true)", [inv.tenant_id]);
      if (!inv.customer_id) await assertEntitled(db, inv.tenant_id, "users", 0);
      await db.query(`insert into memberships(tenant_id,user_id,role_id,branch_ids,customer_id) values ($1,$2,$3,$4,$5)
                      on conflict (tenant_id,user_id) do update set status='active', role_id=excluded.role_id, branch_ids=excluded.branch_ids, customer_id=excluded.customer_id`,
        [inv.tenant_id, user.id, inv.role_id, inv.branch_ids, inv.customer_id]);
      await db.query("update invitations set status='accepted' where id=$1", [inv.id]);
      await audit(db, { tenantId: inv.tenant_id, actorUserId: user.id, action: "invitation.accepted", entityType: "invitation", entityId: inv.id });
      const needsLogin = !ctx;
      const tok = needsLogin ? await createSession(db, user.id, !user.totp_enabled) : null;
      return { tok, mfa: user.totp_enabled };
    });
    if (out.tok) await setSessionCookie(out.tok);
    return { ok: true, redirectTo: out.mfa && out.tok ? "/login/2fa" : "/workspaces" };
  } catch (e) { return fail(e); }
}

export async function selectWorkspaceAction(tenantId: string): Promise<ActionResult> {
  try {
    const ctx = await requireUser();
    const dest = await withSystem(async (db) => {
      const m = (await db.query("select m.customer_id, t.status from memberships m join tenants t on t.id=m.tenant_id where m.tenant_id=$1 and m.user_id=$2 and m.status='active'", [tenantId, ctx.user.id])).rows[0];
      if (!m) throw new UserError("You no longer have access to that company.");
      await db.query("update sessions set tenant_id=$2 where id=$1", [ctx.sessionId, tenantId]);
      return m.customer_id ? "/portal" : "/app";
    });
    return { ok: true, redirectTo: dest };
  } catch (e) { return fail(e); }
}

// ---------- profile / security ----------
export async function changePasswordAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireUser();
    const cur = String(f.get("current") ?? ""), pw = String(f.get("password") ?? "");
    const problem = passwordProblem(pw); if (problem) throw new UserError(problem, { password: problem });
    const hash = await hashPassword(pw);
    await withSystem(async (db) => {
      const u = (await db.query("select password_hash from users where id=$1", [ctx.user.id])).rows[0];
      if (!(await verifyPassword(cur, u.password_hash))) throw new UserError("Your current password is incorrect.", { current: "Incorrect" });
      await db.query("update users set password_hash=$2 where id=$1", [ctx.user.id, hash]);
      await revokeUserSessions(db, ctx.user.id, undefined, ctx.sessionId);
      await audit(db, { tenantId: ctx.tenant?.id, actorUserId: ctx.user.id, action: "user.password_changed" });
    });
    return { ok: true, message: "Password changed. Other devices were signed out." };
  } catch (e) { return fail(e); }
}

export async function startTotpAction(): Promise<{ secret: string; uri: string }> {
  const ctx = await requireUser();
  const secret = newSecret();
  await withSystem((db) => db.query("update users set totp_secret=$2, totp_enabled=false where id=$1 and totp_enabled=false", [ctx.user.id, secret]));
  return { secret, uri: otpauthUri(ctx.user.email, secret) };
}
export async function enableTotpAction(_p: ActionResult | null, f: FormData): Promise<ActionResult & { codes?: string[] }> {
  try {
    const ctx = await requireUser();
    const code = s(f, "code");
    const codes = await withSystem(async (db) => {
      const u = (await db.query("select totp_secret from users where id=$1", [ctx.user.id])).rows[0];
      if (!u.totp_secret || !verifyTotp(u.totp_secret, code)) throw new UserError("That code is not valid. Start again if the key changed.", { code: "Invalid code" });
      const plain = Array.from({ length: 8 }, () => randomBytes(5).toString("hex"));
      await db.query("update users set totp_enabled=true, recovery_codes=$2 where id=$1", [ctx.user.id, plain.map((c) => sha256(c))]);
      await db.query("update sessions set mfa_ok=true where id=$1", [ctx.sessionId]);
      await audit(db, { tenantId: ctx.tenant?.id, actorUserId: ctx.user.id, action: "user.2fa_enabled" });
      return plain;
    });
    return { ok: true, message: "Two-factor authentication is on. Save these recovery codes now — they are shown once:\n" + codes.join("   "), codes };
  } catch (e) { return fail(e); }
}
export async function disableTotpAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireUser();
    if (ctx.user.platformRole) throw new UserError("Platform staff must keep two-factor authentication on.");
    const pw = String(f.get("password") ?? "");
    await withSystem(async (db) => {
      const u = (await db.query("select password_hash from users where id=$1", [ctx.user.id])).rows[0];
      if (!(await verifyPassword(pw, u.password_hash))) throw new UserError("Password is incorrect.", { password: "Incorrect" });
      await db.query("update users set totp_enabled=false, totp_secret=null, recovery_codes='{}' where id=$1", [ctx.user.id]);
      await audit(db, { tenantId: ctx.tenant?.id, actorUserId: ctx.user.id, action: "user.2fa_disabled" });
    });
    return { ok: true, message: "Two-factor authentication turned off." };
  } catch (e) { return fail(e); }
}
export async function revokeSessionAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireUser();
    await withSystem((db) => db.query("update sessions set revoked_at=now() where id=$1 and user_id=$2", [id, ctx.user.id]));
    return { ok: true };
  } catch (e) { return fail(e); }
}
export async function savePrefsAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireUser();
    const prefs = { email_approvals: f.get("email_approvals") === "on", email_billing: f.get("email_billing") === "on" };
    await withSystem((db) => db.query("update users set notif_prefs=$2, name=coalesce(nullif($3,''),name) where id=$1", [ctx.user.id, JSON.stringify(prefs), s(f, "name")]));
    return { ok: true, message: "Preferences saved." };
  } catch (e) { return fail(e); }
}
void withTenantSystem;
