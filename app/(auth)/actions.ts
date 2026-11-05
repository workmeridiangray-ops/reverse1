"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, queueEmail, tx, UserError } from "@/lib/server/db";
import { checkPasswordStrength, clientIp, endSession, getAuth, hashPassword, newToken, requireUser, sha256, startSession, verifyPassword } from "@/lib/server/auth";
import { type FormState, str, toState } from "@/lib/server/actions";

const APP_URL = () => process.env.APP_URL ?? "http://localhost:3000";
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : "/app");

export async function signUp(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const d = z.object({
      name: z.string().trim().min(2, "Enter your name").max(120),
      business: z.string().trim().min(2, "Enter your business name").max(160),
      email, password: z.string().max(200),
      plan: z.string().max(40).optional(), terms: z.literal("on", { error: "Accept the terms to continue" }),
    }).parse({ name: str(fd, "name"), business: str(fd, "business"), email: str(fd, "email"), password: String(fd.get("password") ?? ""), plan: str(fd, "plan") || undefined, terms: str(fd, "terms") });
    checkPasswordStrength(d.password);
    const userId = randomUUID(), tenantId = randomUUID();
    const hash = await hashPassword(d.password);
    const token = newToken();
    await tx({ userId, tenantId, role: "owner" }, async (db) => {
      if (await db.maybe("SELECT 1 FROM users WHERE lower(email) = $1", [d.email])) throw new UserError("An account with this email already exists. Sign in or reset your password.", "email");
      const plan = await db.one<{ id: string }>("SELECT id FROM plans WHERE code = $1 AND active ORDER BY version DESC LIMIT 1", [d.plan && /^[a-z]+$/.test(d.plan) ? d.plan : "starter"]).catch(() => db.one<{ id: string }>("SELECT id FROM plans WHERE code='starter' ORDER BY version DESC LIMIT 1"));
      await db.exec("INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)", [userId, d.email, d.name, hash]);
      const slug = d.business.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + tenantId.slice(0, 6);
      await db.exec("INSERT INTO tenants(id,name,slug,status,plan_id,trial_ends_at) VALUES ($1,$2,$3,'trial',$4, now() + interval '14 days')", [tenantId, d.business, slug, plan.id]);
      await db.exec("INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,'owner')", [tenantId, userId]);
      await db.exec("INSERT INTO plan_changes(tenant_id,to_plan_id,changed_by) VALUES ($1,$2,$3)", [tenantId, plan.id, userId]);
      await db.exec("INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES ($1,'verify',$2, now() + interval '3 days')", [userId, sha256(token)]);
      await queueEmail(db, tenantId, d.email, "Verify your email", `Welcome to SiteLedger.\n\nVerify your email: ${APP_URL()}/verify?token=${token}\n`);
      await audit(db, userId, tenantId, "tenant.created", "tenant", tenantId, { plan: plan.id });
    });
    await startSession(userId, tenantId);
  } catch (e) {
    return toState(e);
  }
  redirect("/app?welcome=1");
}

export async function signIn(_p: FormState, fd: FormData): Promise<FormState> {
  let dest = "/app";
  try {
    const em = email.parse(str(fd, "email"));
    const pw = String(fd.get("password") ?? "");
    const ip = await clientIp();
    const keys = [`login:${em}`, `ip:${ip}`];
    const user = await tx({}, async (db) => {
      const tooMany = await db.one<{ a: number; b: number }>(
        "SELECT count(*) FILTER (WHERE key=$1)::int a, count(*) FILTER (WHERE key=$2)::int b FROM login_attempts WHERE at > now() - interval '15 minutes'", keys);
      if (tooMany.a >= 8 || tooMany.b >= 40) throw new UserError("Too many failed attempts. Wait 15 minutes or reset your password.");
      return db.maybe<{ id: string; password_hash: string; status: string; is_platform_admin: boolean }>("SELECT id,password_hash,status,is_platform_admin FROM users WHERE lower(email) = $1", [em]);
    });
    const ok = user ? await verifyPassword(pw, user.password_hash) : (await hashPassword(pw), false);
    if (!user || !ok || user.status !== "active") {
      await tx({}, async (db) => { for (const k of keys) await db.exec("INSERT INTO login_attempts(key) VALUES ($1)", [k]); });
      throw new UserError(user && user.status !== "active" ? "This account is disabled. Contact your administrator." : "Email or password is incorrect.");
    }
    const memberships = await tx({ userId: user.id }, async (db) => {
      await db.exec("DELETE FROM login_attempts WHERE key = $1", [keys[0]]);
      await audit(db, user.id, null, "auth.login", "user", user.id);
      return db.q<{ tenant_id: string }>("SELECT m.tenant_id FROM memberships m WHERE m.user_id = $1 AND m.status = 'active' ORDER BY m.created_at", [user.id]);
    });
    const next = str(fd, "next");
    if (memberships.length === 1) { await startSession(user.id, memberships[0]!.tenant_id); dest = safeNext(next || "/app"); }
    else if (memberships.length === 0 && user.is_platform_admin) { await startSession(user.id, null); dest = "/platform"; }
    else { await startSession(user.id, null); dest = next ? `/workspaces?next=${encodeURIComponent(safeNext(next))}` : "/workspaces"; }
  } catch (e) {
    return toState(e);
  }
  redirect(dest);
}

export async function signOut() {
  await endSession();
  redirect("/login?reason=signed-out");
}

export async function requestReset(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const em = email.parse(str(fd, "email"));
    const ip = await clientIp();
    await tx({}, async (db) => {
      const n = await db.one<{ n: number }>("SELECT count(*)::int n FROM login_attempts WHERE key = $1 AND at > now() - interval '1 hour'", [`reset:${ip}`]);
      if (n.n >= 10) throw new UserError("Too many requests. Try again later.");
      await db.exec("INSERT INTO login_attempts(key) VALUES ($1)", [`reset:${ip}`]);
      const u = await db.maybe<{ id: string }>("SELECT id FROM users WHERE lower(email) = $1 AND status='active'", [em]);
      if (u) {
        const token = newToken();
        await db.exec("INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES ($1,'reset',$2, now() + interval '1 hour')", [u.id, sha256(token)]);
        await queueEmail(db, null, em, "Reset your password", `Reset your SiteLedger password (valid for one hour): ${APP_URL()}/reset?token=${token}\n\nIf you did not ask for this, ignore this email.`);
      }
    });
    return { ok: true, message: "If an account exists for that email, a reset link is on its way. It is valid for one hour." };
  } catch (e) {
    return toState(e);
  }
}

export async function resetPassword(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const token = str(fd, "token");
    const pw = String(fd.get("password") ?? "");
    checkPasswordStrength(pw);
    if (pw !== String(fd.get("confirm") ?? "")) throw new UserError("Passwords do not match.", "confirm");
    const hash = await hashPassword(pw);
    await tx({}, async (db) => {
      const t = await db.maybe<{ id: string; user_id: string }>("SELECT id,user_id FROM auth_tokens WHERE token_hash=$1 AND kind='reset' AND used_at IS NULL AND expires_at > now() FOR UPDATE", [sha256(token)]);
      if (!t) throw new UserError("This reset link is invalid or has expired. Request a new one.");
      await db.exec("UPDATE auth_tokens SET used_at = now() WHERE id = $1", [t.id]);
      await db.exec("UPDATE users SET password_hash=$1, failed_logins=0 WHERE id=$2", [hash, t.user_id]);
      await db.exec("UPDATE sessions SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL", [t.user_id]);
      await audit(db, t.user_id, null, "auth.password_reset", "user", t.user_id);
    });
  } catch (e) {
    return toState(e);
  }
  redirect("/login?reason=password-reset");
}

export async function selectWorkspace(fd: FormData) {
  const a = await requireUser();
  const tenantId = z.string().uuid().parse(str(fd, "tenant_id"));
  const ok = await tx({ userId: a.user.id }, (db) => db.maybe("SELECT 1 FROM memberships WHERE user_id=$1 AND tenant_id=$2 AND status='active'", [a.user.id, tenantId]));
  if (!ok) redirect("/denied");
  await tx({ userId: a.user.id }, async (db) => {
    await db.exec("UPDATE sessions SET tenant_id=$1 WHERE id=$2", [tenantId, a.sessionId]);
    await audit(db, a.user.id, tenantId, "workspace.switch", "tenant", tenantId);
  });
  const next = str(fd, "next");
  redirect(safeNext(next || "/app"));
}

export async function acceptInvite(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const token = str(fd, "token");
    const { auth } = await getAuth();
    let userId = auth?.user.id ?? null;
    let tenantId = "";
    const name = str(fd, "name"), pw = String(fd.get("password") ?? "");
    let hash = "";
    if (!userId) {
      if (name.length < 2) throw new UserError("Enter your name.", "name");
      checkPasswordStrength(pw);
      hash = await hashPassword(pw);
    }
    await tx({ inviteLookup: true }, async (db) => {
      const inv = await db.maybe<{ id: string; tenant_id: string; email: string; role: string; project_ids: string[] }>(
        "SELECT id,tenant_id,email,role,project_ids FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE", [sha256(token)]);
      if (!inv) throw new UserError("This invitation is invalid, expired or was revoked. Ask the sender for a new one.");
      tenantId = inv.tenant_id;
      const existing = await db.maybe<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1)", [inv.email]);
      if (userId) {
        if (auth!.user.email.toLowerCase() !== inv.email.toLowerCase()) throw new UserError(`This invitation was sent to ${inv.email}. Sign out and use that account.`);
      } else if (existing) {
        throw new UserError("An account with this email already exists. Sign in first, then open the invitation link again.");
      } else {
        userId = randomUUID();
        await db.exec("INSERT INTO users(id,email,name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,now())", [userId, inv.email.toLowerCase(), name, hash]);
      }
      await db.exec("SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true), set_config('app.role','owner',true)", [inv.tenant_id, userId]);
      await db.exec("INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role, status='active'", [inv.tenant_id, userId, inv.role]);
      for (const pid of inv.project_ids) await db.exec("INSERT INTO project_access(tenant_id,project_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [inv.tenant_id, pid, userId]);
      await db.exec("UPDATE invitations SET accepted_at = now() WHERE id=$1", [inv.id]);
      await audit(db, userId, inv.tenant_id, "invitation.accepted", "invitation", inv.id, { role: inv.role });
    });
    if (auth) {
      await tx({ userId: auth.user.id }, (db) => db.exec("UPDATE sessions SET tenant_id=$1 WHERE id=$2", [tenantId, auth.sessionId]));
    } else {
      await startSession(userId!, tenantId);
    }
  } catch (e) {
    return toState(e);
  }
  redirect("/app");
}
