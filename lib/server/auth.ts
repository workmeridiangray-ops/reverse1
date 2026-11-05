import "server-only";
import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { type Db, tx, UserError } from "./db";
import { can, isExternal, isRole, type Permission, type Role } from "@/lib/rules/permissions";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = "sid";
const IDLE_MS = 12 * 3600_000;          // idle timeout
const ABSOLUTE_MS = 14 * 24 * 3600_000; // absolute lifetime

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const expected = Buffer.from(h, "base64");
  const got = await scrypt(pw, Buffer.from(s, "base64"), expected.length);
  return timingSafeEqual(got, expected);
}
export function checkPasswordStrength(pw: string) {
  if (pw.length < 10) throw new UserError("Use at least 10 characters.", "password");
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new UserError("Use letters and at least one number.", "password");
}

export async function startSession(userId: string, tenantId: string | null) {
  const token = newToken();
  const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
  await tx({ userId }, (db) =>
    db.exec("INSERT INTO sessions(user_id,token_hash,tenant_id,expires_at,user_agent) VALUES ($1,$2,$3,now() + interval '14 days',$4)", [userId, sha256(token), tenantId, ua]),
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    maxAge: ABSOLUTE_MS / 1000,
  });
}
export async function endSession() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) await tx({}, (db) => db.exec("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [sha256(t)]));
  jar.delete(COOKIE);
}

export interface Auth {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean; verified: boolean };
  sessionId: string;
  tenantId: string | null;
}

/** Resolve the signed-in user from the cookie, or null. Sets nothing; safe to call from server components. */
export const getAuth = cache(async (): Promise<{ auth: Auth | null; expired: boolean }> => {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return { auth: null, expired: false };
  const row = await tx({}, (db) =>
    db.maybe<{ sid: string; tenant_id: string | null; id: string; email: string; name: string; is_platform_admin: boolean; status: string; verified: string | null; expires_at: Date; revoked_at: Date | null; last_seen_at: Date }>(
      `SELECT s.id sid, s.tenant_id, u.id, u.email, u.name, u.is_platform_admin, u.status, u.email_verified_at verified, s.expires_at, s.revoked_at, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [sha256(t)]),
  );
  if (!row || row.revoked_at || row.status !== "active" || row.expires_at < new Date() || Date.now() - row.last_seen_at.getTime() > IDLE_MS)
    return { auth: null, expired: true };
  if (Date.now() - row.last_seen_at.getTime() > 5 * 60_000)
    await tx({}, (db) => db.exec("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.sid]));
  return {
    auth: { user: { id: row.id, email: row.email, name: row.name, isPlatformAdmin: row.is_platform_admin, verified: !!row.verified }, sessionId: row.sid, tenantId: row.tenant_id },
    expired: false,
  };
});

export async function requireUser(): Promise<Auth> {
  const { auth, expired } = await getAuth();
  if (!auth) redirect(expired ? "/login?reason=expired" : "/login");
  return auth;
}

export interface Ctx {
  user: Auth["user"];
  sessionId: string;
  tenant: { id: string; name: string; status: string; currency: string; planId: string; trialEndsAt: Date | null; locked: boolean; lockReason: string | null };
  role: Role;
  allProjects: boolean;
  /** Run in a transaction scoped (via row-level security) to this user's tenant, role and project access. */
  run<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  can(p: Permission): boolean;
  external: boolean;
}

export const getCtx = cache(async (): Promise<Ctx | "no-tenant" | "none"> => {
  const { auth } = await getAuth();
  if (!auth) return "none";
  if (!auth.tenantId) return "no-tenant";
  const rows = await tx({ userId: auth.user.id, tenantId: auth.tenantId }, async (db) => {
    const m = await db.maybe<{ role: string; status: string }>("SELECT role, status FROM memberships WHERE tenant_id = $1 AND user_id = $2", [auth.tenantId, auth.user.id]);
    const t = await db.maybe<{ id: string; name: string; status: string; currency: string; plan_id: string; trial_ends_at: Date | null; grace_until: Date | null }>(
      "SELECT id,name,status,currency,plan_id,trial_ends_at,grace_until FROM tenants WHERE id = $1", [auth.tenantId]);
    const restricted = m && m.role !== "owner" ? await db.maybe<{ n: number }>("SELECT count(*)::int n FROM project_access WHERE user_id = $1", [auth.user.id]) : null;
    return { m, t, restricted };
  });
  if (!rows.m || rows.m.status !== "active" || !rows.t || !isRole(rows.m.role)) return "no-tenant";
  const role = rows.m.role;
  const t = rows.t;
  const trialOver = t.status === "trial" && t.trial_ends_at && t.trial_ends_at < new Date();
  const pastDueOver = t.status === "past_due" && (!t.grace_until || t.grace_until < new Date());
  const locked = t.status === "suspended" || t.status === "closed" || !!trialOver || pastDueOver;
  const lockReason = t.status === "suspended" ? "This business account is suspended. Contact support." : t.status === "closed" ? "This business account is closed." : trialOver ? "Your trial has ended. Choose a plan to continue." : pastDueOver ? "Payment is overdue and the grace period has ended. Update payment to continue." : null;
  // External users, and internal users who have explicit project assignments, only see assigned projects.
  const allProjects = !isExternal(role) && (role === "owner" || !rows.restricted || rows.restricted.n === 0);
  const scope = { tenantId: auth.tenantId, userId: auth.user.id, role, allProjects };
  return {
    user: auth.user, sessionId: auth.sessionId,
    tenant: { id: t.id, name: t.name, status: t.status, currency: t.currency, planId: t.plan_id, trialEndsAt: t.trial_ends_at, locked, lockReason },
    role, allProjects, external: isExternal(role),
    run: (fn) => tx(scope, fn),
    can: (p) => can(role, p),
  };
});

/** Page guard. `perm` is checked on the server; otherwise redirect to the access-denied screen. */
export async function requireCtx(perm?: Permission, opts: { allowLocked?: boolean } = {}): Promise<Ctx> {
  await requireUser();
  const c = await getCtx();
  if (c === "none") redirect("/login");
  if (c === "no-tenant") redirect("/workspaces");
  if (c.tenant.locked && !opts.allowLocked) redirect(c.role === "owner" ? "/app/settings?locked=1" : "/app");
  if (perm && !c.can(perm)) redirect("/denied");
  return c;
}

export async function requirePlatform(): Promise<Auth> {
  const a = await requireUser();
  if (!a.user.isPlatformAdmin) redirect("/denied");
  return a;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}
