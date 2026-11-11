import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { plat } from "./db";
import { sha256, token } from "./crypto";
import { can, type Perm, type Role } from "./perms";

const COOKIE = "sid";
const IDLE_MS = 12 * 3600_000, ABS_MS = 7 * 24 * 3600_000;

export type Auth = {
  user: { id: string; email: string; name: string; platformRole: string | null; totpEnabled: boolean; verified: boolean };
  session: { id: string; mfaOk: boolean; companyId: string | null };
  company: { id: string; name: string; status: string; slug: string; demo: boolean; trialExpired: boolean } | null;
  membership: { id: string; role: Role; plantIds: string[]; partyId: string | null } | null;
};

export async function createSession(userId: string, mfaOk: boolean) {
  const t = token(); const h = await headers();
  const mems = await plat("select company_id from memberships where user_id=$1 and active", [userId]);
  await plat("insert into sessions(user_id,token_hash,company_id,mfa_ok,user_agent,ip,expires_at) values ($1,$2,$3,$4,$5,$6,now()+interval '7 days')",
    [userId, sha256(t), mems.rowCount === 1 ? mems.rows[0].company_id : null, mfaOk, (h.get("user-agent") ?? "").slice(0, 200), (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null]);
  (await cookies()).set(COOKIE, t, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ABS_MS / 1000 });
}
export async function destroySession() {
  const c = await cookies(); const t = c.get(COOKIE)?.value;
  if (t) await plat("update sessions set revoked_at=now() where token_hash=$1", [sha256(t)]);
  c.delete(COOKIE);
}

export const getAuth = cache(async (): Promise<Auth | { expired: true } | null> => {
  const t = (await cookies()).get(COOKIE)?.value; if (!t) return null;
  const r = await plat(`select s.id sid, s.mfa_ok, s.company_id, s.revoked_at, s.expires_at, s.last_seen_at, u.id uid, u.email, u.name, u.platform_role, u.totp_enabled, u.suspended, u.email_verified_at
     from sessions s join users u on u.id=s.user_id where s.token_hash=$1`, [sha256(t)]);
  const s = r.rows[0]; if (!s) return null;
  if (s.revoked_at || new Date(s.expires_at) < new Date() || Date.now() - new Date(s.last_seen_at).getTime() > IDLE_MS || s.suspended) return { expired: true };
  if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) await plat("update sessions set last_seen_at=now() where id=$1", [s.sid]);
  let company = null, membership = null;
  if (s.company_id) {
    const m = await plat(`select m.id, m.role, m.plant_ids, m.party_id, c.id cid, c.name, c.status, c.slug, c.demo, c.trial_ends_at from memberships m join companies c on c.id=m.company_id where m.user_id=$1 and m.company_id=$2 and m.active`, [s.uid, s.company_id]);
    if (m.rows[0]) { const x = m.rows[0]; company = { id: x.cid, name: x.name, status: x.status, slug: x.slug, demo: x.demo, trialExpired: x.status === "trial" && !!x.trial_ends_at && new Date(x.trial_ends_at) < new Date() }; membership = { id: x.id, role: x.role as Role, plantIds: x.plant_ids, partyId: x.party_id }; }
  }
  return { user: { id: s.uid, email: s.email, name: s.name, platformRole: s.platform_role, totpEnabled: s.totp_enabled, verified: !!s.email_verified_at }, session: { id: s.sid, mfaOk: s.mfa_ok, companyId: s.company_id }, company, membership };
});

export async function requireUser(): Promise<Auth> {
  const a = await getAuth();
  if (!a) redirect("/login");
  if ("expired" in a) redirect("/login?expired=1");
  if (a.user.totpEnabled && !a.session.mfaOk) redirect("/login/2fa");
  return a;
}
export type CompanyAuth = Auth & { company: NonNullable<Auth["company"]>; membership: NonNullable<Auth["membership"]> };
/** Server-side gate used by every app page and action. */
export async function requireCompany(perm?: Perm, opts?: { allowSuspended?: boolean }): Promise<CompanyAuth> {
  const a = await requireUser();
  if (!a.company || !a.membership) redirect("/workspaces");
  if (!opts?.allowSuspended && (a.company.status === "suspended" || a.company.status === "closed" || a.company.trialExpired)) redirect("/suspended");
  if (perm && !can(a.membership.role, perm)) redirect("/denied");
  return a as CompanyAuth;
}
export async function requirePlatform(...roles: string[]): Promise<Auth> {
  const a = await requireUser();
  if (!a.user.platformRole || (roles.length && !roles.includes(a.user.platformRole) && a.user.platformRole !== "owner")) redirect("/denied");
  return a;
}
export async function revokeUserSessions(userId: string, companyId?: string) {
  await plat("update sessions set revoked_at=now() where user_id=$1 and revoked_at is null and ($2::uuid is null or company_id=$2)", [userId, companyId ?? null]);
}
export async function clientIp() { return ((await headers()).get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null; }
