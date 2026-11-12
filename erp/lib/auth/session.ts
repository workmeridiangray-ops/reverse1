import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { withSystem, withTenant, type Db } from "../db";
import { newToken, sha256 } from "./password";
import { AccessDenied } from "../errors";
import { isProd } from "../env";

export const COOKIE = "erp_session";
const IDLE_MS = 12 * 3600_000;      // idle timeout
const ABS_MS = 14 * 24 * 3600_000;  // absolute lifetime

export interface Ctx {
  sessionId: string;
  user: { id: string; email: string; name: string; platformRole: string | null; totpEnabled: boolean };
  mfaOk: boolean;
  tenant: null | { id: string; name: string; slug: string; status: string; trialEndsAt: string | null; currency: string; setup: any; branding: any };
  membership: null | { id: string; roleKey: string; roleName: string; branchIds: string[] | null; customerId: string | null };
  perms: Set<string>;
  readOnlyReason: string | null;   // set when the company is in expired/past-due/support (read-only) state
  supportMode: boolean;
}

export async function createSession(db: Db, userId: string, mfaOk: boolean): Promise<string> {
  const token = newToken();
  const h = await headers();
  await db.query(
    `insert into sessions(token_hash, user_id, mfa_ok, ip, user_agent, expires_at) values ($1,$2,$3,$4,$5, now() + $6::interval)`,
    [sha256(token), userId, mfaOk, h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, (h.get("user-agent") ?? "").slice(0, 200), `${ABS_MS} milliseconds`],
  );
  return token;
}
export async function setSessionCookie(token: string) {
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: ABS_MS / 1000 });
}
export async function clearSessionCookie() { (await cookies()).delete(COOKIE); }

export async function revokeUserSessions(db: Db, userId: string, tenantId?: string, exceptSessionId?: string) {
  await db.query(
    `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null
       and ($2::uuid is null or tenant_id = $2) and ($3::uuid is null or id <> $3)`, [userId, tenantId ?? null, exceptSessionId ?? null]);
}

/** Loads the session, user, workspace, role permissions. Returns null if there is no valid session. */
export async function getCtx(): Promise<Ctx | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return withSystem(async (db) => {
    const s = (await db.query(
      `select s.id, s.mfa_ok, s.tenant_id, s.last_seen_at, u.id uid, u.email, u.name, u.platform_role, u.totp_enabled, u.status ustatus
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sha256(token)])).rows[0];
    if (!s || s.ustatus !== "active") return null;
    if (Date.now() - new Date(s.last_seen_at).getTime() > IDLE_MS) {
      await db.query("update sessions set revoked_at = now() where id = $1", [s.id]);
      return null;
    }
    if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) await db.query("update sessions set last_seen_at = now() where id = $1", [s.id]);
    const ctx: Ctx = {
      sessionId: s.id, mfaOk: s.mfa_ok,
      user: { id: s.uid, email: s.email, name: s.name, platformRole: s.platform_role, totpEnabled: s.totp_enabled },
      tenant: null, membership: null, perms: new Set(), readOnlyReason: null, supportMode: false,
    };
    if (s.tenant_id) {
      const m = (await db.query(
        `select m.id, m.branch_ids, m.customer_id, r.key, r.name, r.permissions, t.id tid, t.name tname, t.slug, t.status, t.trial_ends_at, t.currency, t.setup, t.branding
           from memberships m join roles r on r.id = m.role_id join tenants t on t.id = m.tenant_id
          where m.tenant_id = $1 and m.user_id = $2 and m.status = 'active'`, [s.tenant_id, s.uid])).rows[0];
      if (m) {
        ctx.tenant = { id: m.tid, name: m.tname, slug: m.slug, status: m.status, trialEndsAt: m.trial_ends_at, currency: m.currency, setup: m.setup, branding: m.branding };
        ctx.membership = { id: m.id, roleKey: m.key, roleName: m.name, branchIds: m.branch_ids, customerId: m.customer_id };
        ctx.perms = new Set(m.permissions as string[]);
        ctx.readOnlyReason = await tenantReadOnlyReason(db, m.tid, m.status, m.trial_ends_at);
      } else {
        // access removed since the workspace was selected
        await db.query("update sessions set tenant_id = null where id = $1", [s.id]);
      }
    }
    return ctx;
  });
}

async function tenantReadOnlyReason(db: Db, tenantId: string, status: string, trialEndsAt: string | null): Promise<string | null> {
  if (status === "suspended") return "This company account is suspended. Contact support to restore access.";
  if (status === "closed" || status === "cancelled") return "This company account is closed. Data export is still available.";
  const sub = (await db.query("select status, grace_until, current_period_end from subscriptions where tenant_id=$1 and status in ('trialing','active','past_due') limit 1", [tenantId])).rows[0];
  if (!sub) return "No active subscription. Choose a plan to continue working.";
  if (sub.status === "trialing" && trialEndsAt && new Date(trialEndsAt) < new Date()) return "Your free trial has ended. Choose a plan to continue working; your data is kept.";
  if (sub.status === "past_due" && sub.grace_until && new Date(sub.grace_until) < new Date()) return "Your last payment failed and the grace period has ended. Update payment to restore editing.";
  return null;
}

// ----- guards for pages and actions -----
export async function requireUser(): Promise<Ctx> {
  const c = await getCtx();
  if (!c) redirect("/login?expired=1");
  return c;
}
export async function requireTenant(perm?: string): Promise<Ctx & { tenant: NonNullable<Ctx["tenant"]>; membership: NonNullable<Ctx["membership"]> }> {
  const c = await requireUser();
  if (!c.tenant || !c.membership) redirect("/workspaces");
  if (c.tenant.status === "closed") redirect("/closed");
  if (perm && !c.perms.has(perm)) redirect("/denied");
  return c as any;
}
export async function requirePlatform(...roles: string[]): Promise<Ctx> {
  const c = await requireUser();
  if (!c.user.platformRole) redirect("/denied");
  if (!c.user.totpEnabled) redirect("/account?need2fa=1");      // two-factor is mandatory for platform staff
  if (!c.mfaOk) redirect("/login/2fa");
  if (roles.length && c.user.platformRole !== "owner" && !roles.includes(c.user.platformRole)) redirect("/denied");
  return c;
}
export function can(c: Ctx, perm: string) { return c.perms.has(perm); }

/** Branch visibility filter: null = all branches. */
export function branchScope(c: Ctx): string[] | null { return c.membership?.branchIds ?? null; }

export { withTenant };
