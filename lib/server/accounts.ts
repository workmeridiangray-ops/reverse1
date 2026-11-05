import "server-only";
import { plat, tx, UserError } from "./db";
import { auditPlat, audit } from "./audit";
import { hashPassword, passwordProblem, sha256, token, verifyPassword, totpValid } from "./crypto";
import { sendEmail, APP_URL } from "./mail";
import { currentPlanVersions, assertWithin, TRIAL_DAYS } from "./billing";
import { revokeUserSessions } from "./auth";
import type { Role } from "./perms";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normEmail = (e: string) => e.trim().toLowerCase();
export function checkEmail(e: string) { if (!EMAIL_RE.test(e) || e.length > 200) throw new UserError("Enter a valid email address."); }

export async function signup(a: { name: string; email: string; password: string; company: string }) {
  const email = normEmail(a.email); checkEmail(email);
  if (a.name.trim().length < 2) throw new UserError("Enter your name.");
  if (a.company.trim().length < 2) throw new UserError("Enter your company name.");
  const pw = passwordProblem(a.password); if (pw) throw new UserError(pw);
  const exists = await plat("select 1 from users where lower(email)=$1", [email]);
  if (exists.rowCount) throw new UserError("An account with this email already exists. Sign in or reset your password.", "exists");
  const starter = (await currentPlanVersions())[0];
  const slug = a.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
  const ids = await tx(async (c) => {
    const u = (await c.query("insert into users(email,name,password_hash) values ($1,$2,$3) returning id", [email, a.name.trim(), hashPassword(a.password)])).rows[0];
    const co = (await c.query("insert into companies(name,slug,billing_email,status,trial_ends_at) values ($1,$2,$3,'trial',now()+($4||' days')::interval) returning id", [a.company.trim(), slug, email, String(TRIAL_DAYS)])).rows[0];
    await c.query("insert into memberships(company_id,user_id,role) values ($1,$2,'owner')", [co.id, u.id]);
    await c.query("insert into subscriptions(company_id,plan_version_id,cycle,status,period_start,period_end) values ($1,$2,'monthly','trialing',now(),now()+($3||' days')::interval)", [co.id, starter.version_id, String(TRIAL_DAYS)]);
    return { userId: u.id as string, companyId: co.id as string };
  });
  await sendVerification(ids.userId, email);
  await auditPlat({ userId: ids.userId, companyId: ids.companyId }, "account.signup", "company", ids.companyId);
  return ids;
}
export async function sendVerification(userId: string, email: string) {
  const t = token();
  await plat("insert into auth_tokens(user_id,kind,token_hash,expires_at) values ($1,'verify',$2,now()+interval '2 days')", [userId, sha256(t)]);
  await sendEmail(email, "Verify your email", `Confirm your email to finish setting up your workspace:\n${APP_URL()}/verify?token=${t}\n\nThis link expires in 2 days.`);
}
export async function verifyEmail(t: string) {
  const r = await plat("update auth_tokens set used_at=now() where token_hash=$1 and kind='verify' and used_at is null and expires_at>now() returning user_id", [sha256(t)]);
  if (!r.rowCount) throw new UserError("This verification link is invalid or has expired. Sign in to request a new one.", "expired");
  await plat("update users set email_verified_at=now() where id=$1", [r.rows[0].user_id]);
}
export type LoginResult = { userId: string; needsMfa: boolean };
const MAX_FAILS = 5;
export async function login(emailIn: string, password: string): Promise<LoginResult> {
  const email = normEmail(emailIn);
  const u = (await plat("select * from users where lower(email)=$1", [email])).rows[0];
  const bad = new UserError("Email or password is incorrect.", "credentials");
  if (!u) { hashPassword(password); throw bad; }   // equalise timing
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new UserError("Too many failed attempts. Try again in 15 minutes or reset your password.", "locked");
  if (!verifyPassword(password, u.password_hash)) {
    const n = u.failed_logins + 1;
    await plat("update users set failed_logins=$2::int, locked_until=case when $2::int>=$3::int then now()+interval '15 minutes' else null end where id=$1", [u.id, n, MAX_FAILS]);
    throw bad;
  }
  if (u.suspended) throw new UserError("This account has been suspended. Contact support.", "suspended");
  await plat("update users set failed_logins=0, locked_until=null where id=$1", [u.id]);
  return { userId: u.id, needsMfa: u.totp_enabled };
}
export async function checkMfa(userId: string, code: string) {
  const u = (await plat("select totp_secret from users where id=$1", [userId])).rows[0];
  if (!u?.totp_secret || !totpValid(u.totp_secret, code)) throw new UserError("That code is incorrect or expired.", "mfa");
}
export async function requestReset(emailIn: string) {   // never reveals whether the email exists
  const email = normEmail(emailIn); if (!EMAIL_RE.test(email)) return;
  const u = (await plat("select id from users where lower(email)=$1 and not suspended", [email])).rows[0]; if (!u) return;
  const recent = await plat("select count(*)::int n from auth_tokens where user_id=$1 and kind='reset' and expires_at > now() + interval '30 minutes'", [u.id]);
  if (recent.rows[0].n >= 3) return;
  const t = token();
  await plat("insert into auth_tokens(user_id,kind,token_hash,expires_at) values ($1,'reset',$2,now()+interval '1 hour')", [u.id, sha256(t)]);
  await sendEmail(email, "Reset your password", `Reset your password:\n${APP_URL()}/reset?token=${t}\n\nThis link expires in 1 hour. If you did not ask for this, ignore this email.`);
}
export async function resetPassword(t: string, password: string) {
  const pw = passwordProblem(password); if (pw) throw new UserError(pw);
  const r = await plat("update auth_tokens set used_at=now() where token_hash=$1 and kind='reset' and used_at is null and expires_at>now() returning user_id", [sha256(t)]);
  if (!r.rowCount) throw new UserError("This reset link is invalid, already used, or expired. Request a new one.", "expired");
  await plat("update users set password_hash=$2, failed_logins=0, locked_until=null where id=$1", [r.rows[0].user_id, hashPassword(password)]);
  await revokeUserSessions(r.rows[0].user_id);   // a reset signs out every device
  await auditPlat({ userId: r.rows[0].user_id }, "account.password_reset");
}
export async function changePassword(userId: string, current: string, next: string) {
  const u = (await plat("select password_hash from users where id=$1", [userId])).rows[0];
  if (!verifyPassword(current, u.password_hash)) throw new UserError("Your current password is incorrect.");
  const pw = passwordProblem(next); if (pw) throw new UserError(pw);
  await plat("update users set password_hash=$2 where id=$1", [userId, hashPassword(next)]);
  await auditPlat({ userId }, "account.password_changed");
}
// ---- invitations & memberships ----
export async function invite(companyId: string, by: string, a: { email: string; role: Role; plantIds?: string[]; partyId?: string | null }) {
  const email = normEmail(a.email); checkEmail(email);
  if (a.role === "owner") throw new UserError("There can only be one business owner; transfer ownership instead.");
  if ((a.role === "customer" || a.role === "supplier") && !a.partyId) throw new UserError("Choose which customer or supplier this portal user belongs to.");
  if (a.role !== "customer" && a.role !== "supplier") await assertWithin(companyId, "users");
  const dup = await plat("select 1 from memberships m join users u on u.id=m.user_id where m.company_id=$1 and lower(u.email)=$2 and m.active", [companyId, email]);
  if (dup.rowCount) throw new UserError("This person is already a member.");
  await plat("update invitations set revoked_at=now() where company_id=$1 and lower(email)=$2 and accepted_at is null and revoked_at is null", [companyId, email]);
  const t = token();
  await plat("insert into invitations(company_id,email,role,plant_ids,party_id,token_hash,invited_by,expires_at) values ($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days')", [companyId, email, a.role, a.plantIds ?? [], a.partyId ?? null, sha256(t), by]);
  const co = (await plat("select name from companies where id=$1", [companyId])).rows[0];
  await sendEmail(email, `You're invited to ${co.name}`, `You have been invited as ${a.role}. Accept here:\n${APP_URL()}/invite/${t}\n\nThe invitation expires in 7 days.`, companyId);
  await auditPlat({ userId: by, companyId }, "member.invite", "invitation", undefined, { email, role: a.role });
}
export async function invitationState(t: string) {
  const i = (await plat("select i.*, c.name company from invitations i join companies c on c.id=i.company_id where token_hash=$1", [sha256(t)])).rows[0];
  if (!i) return { state: "invalid" as const };
  if (i.revoked_at) return { state: "revoked" as const };
  if (i.accepted_at) return { state: "used" as const };
  if (new Date(i.expires_at) < new Date()) return { state: "expired" as const };
  const exists = (await plat("select 1 from users where lower(email)=$1", [i.email])).rowCount! > 0;
  return { state: "ok" as const, inv: i, hasAccount: exists };
}
export async function acceptInvitation(t: string, existingUserId: string | null, a?: { name: string; password: string }) {
  const s = await invitationState(t); if (s.state !== "ok") throw new UserError("This invitation is no longer valid.", s.state);
  const i = s.inv; let uid = existingUserId;
  if (!uid) {
    const u = (await plat("select id from users where lower(email)=$1", [i.email])).rows[0];
    if (u) throw new UserError("An account already exists for this email. Sign in first, then open the invitation link again.", "signin");
    if (!a || a.name.trim().length < 2) throw new UserError("Enter your name.");
    const pw = passwordProblem(a.password); if (pw) throw new UserError(pw);
    uid = (await plat("insert into users(email,name,password_hash,email_verified_at) values ($1,$2,$3,now()) returning id", [i.email, a.name.trim(), hashPassword(a.password)])).rows[0].id;
  } else {
    const me = (await plat("select email from users where id=$1", [uid])).rows[0];
    if (normEmail(me.email) !== i.email) throw new UserError(`This invitation is for ${i.email}. Sign in with that account.`, "wrong-user");
  }
  await plat("insert into memberships(company_id,user_id,role,plant_ids,party_id) values ($1,$2,$3,$4,$5) on conflict (company_id,user_id) do update set role=excluded.role, plant_ids=excluded.plant_ids, party_id=excluded.party_id, active=true", [i.company_id, uid, i.role, i.plant_ids, i.party_id]);
  await plat("update invitations set accepted_at=now() where id=$1", [i.id]);
  await auditPlat({ userId: uid!, companyId: i.company_id }, "member.joined", "membership", undefined, { role: i.role });
  return { userId: uid!, companyId: i.company_id as string };
}
export async function revokeInvitation(companyId: string, invId: string, by: string) {
  await plat("update invitations set revoked_at=now() where id=$1 and company_id=$2 and accepted_at is null", [invId, companyId]);
  await auditPlat({ userId: by, companyId }, "member.invite_revoked", "invitation", invId);
}
export async function changeMember(companyId: string, by: string, membershipId: string, patch: { role?: Role; active?: boolean; plantIds?: string[] }, reason: string) {
  const m = (await plat("select * from memberships where id=$1 and company_id=$2", [membershipId, companyId])).rows[0];
  if (!m) throw new UserError("Member not found.", "notfound");
  if (m.role === "owner") throw new UserError("The owner's access cannot be changed here.");
  if (m.user_id === by) throw new UserError("You cannot change your own access.");
  if (!reason.trim()) throw new UserError("A reason is required for access changes.");
  if (patch.active === true && m.active === false && !["customer", "supplier"].includes(patch.role ?? m.role)) await assertWithin(companyId, "users");
  await plat("update memberships set role=coalesce($2,role), active=coalesce($3,active), plant_ids=coalesce($4,plant_ids) where id=$1", [membershipId, patch.role ?? null, patch.active ?? null, patch.plantIds ?? null]);
  if (patch.active === false || (patch.role && patch.role !== m.role)) await revokeUserSessions(m.user_id, companyId);   // access removed → sessions end now
  await auditPlat({ userId: by, companyId }, "member.change", "membership", membershipId, { patch }, reason);
}
export async function switchWorkspace(sessionId: string, userId: string, companyId: string) {
  const m = await plat("select 1 from memberships where user_id=$1 and company_id=$2 and active", [userId, companyId]);
  if (!m.rowCount) throw new UserError("You are not a member of that workspace.", "denied");
  await plat("update sessions set company_id=$2 where id=$1", [sessionId, companyId]);
}
void audit;
