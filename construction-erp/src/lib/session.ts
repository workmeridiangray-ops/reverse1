import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { pool, type Ctx, withTenant, one, many, type Q, AppError, friendly } from './db';
import { sha256 } from './crypto';
import { can as canRole, type Overrides } from './permissions';
import { subscriptionState } from './rules/plan';
import { env } from './env';

export const COOKIE = 'bl_session';

export interface SessionInfo {
  sessionId: string; tokenHash: string;
  user: { id: string; email: string; name: string; platformRole: string | null; totpEnabled: boolean };
  org: { id: string; name: string; slug: string; status: string; brandColor: string | null; setup: any } | null;
  membership: { id: string; role: string; branchIds: string[]; sensitive: string[]; partyId: string | null } | null;
  ctx: Ctx | null;
  sub: { state: string; planCode: string; planName: string; limits: any; trialEndsAt: string | null; periodEnd: string | null; graceUntil: string | null; cancelAtEnd: boolean } | null;
  memberships: { orgId: string; orgName: string; role: string }[];
  pendingMfa: boolean;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/', maxAge: env.sessionDays * 86400 });
}
export async function clearSessionCookie() { (await cookies()).delete(COOKIE); }
export async function clientMeta() {
  const h = await headers();
  return { ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null, ua: h.get('user-agent') };
}

export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const tokenHash = sha256(token);
  const sys: Ctx = { userId: '', orgId: null, role: 'system' };
  return withTenant(sys, async q => {
    const s = await one<any>(q, `select s.*, u.email, u.name, u.platform_role, u.totp_enabled, u.status ustatus from sessions s join users u on u.id = s.user_id
                                  where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [tokenHash]);
    if (!s || s.ustatus !== 'active') return null;
    if (new Date(s.last_seen_at).getTime() < Date.now() - 60_000) await q.query('update sessions set last_seen_at = now() where id = $1', [s.id]);
    const user = { id: s.user_id, email: s.email, name: s.name, platformRole: s.platform_role, totpEnabled: s.totp_enabled };
    const mems = await many<any>(q, `select m.org_id, m.role, o.name from memberships m join orgs o on o.id = m.org_id where m.user_id = $1 and m.status = 'active' order by o.name`, [s.user_id]);
    const base: SessionInfo = { sessionId: s.id, tokenHash, user, org: null, membership: null, ctx: null, sub: null, pendingMfa: s.pending_mfa,
      memberships: mems.map(m => ({ orgId: m.org_id, orgName: m.name, role: m.role })) };
    if (s.pending_mfa) return base;
    if (!s.org_id) return base;
    const org = await one<any>(q, 'select * from orgs where id = $1', [s.org_id]);
    if (!org) return base;
    let role: string | null = null; let m: any = null;
    if (user.platformRole === 'support') {
      const g = await one<any>(q, 'select 1 from support_grants where org_id = $1 and support_user_id = $2 and revoked_at is null and expires_at > now()', [org.id, user.id]);
      if (g) role = 'support';
    } else {
      m = await one<any>(q, `select * from memberships where org_id = $1 and user_id = $2 and status = 'active'`, [org.id, user.id]);
      role = m?.role ?? null;
    }
    if (!role) return base;
    const sub = await one<any>(q, `select s.*, p.code, p.name pname, p.limits from subscriptions s join plans p on p.id = s.plan_id where s.org_id = $1`, [org.id]);
    const state = sub ? subscriptionState({ status: sub.status, trialEndsAt: sub.trial_ends_at, periodEnd: sub.current_period_end, graceUntil: sub.grace_until }, new Date()) : 'expired';
    return {
      ...base,
      org: { id: org.id, name: org.name, slug: org.slug, status: org.status, brandColor: org.brand_color, setup: org.setup },
      membership: m ? { id: m.id, role: m.role, branchIds: m.branch_ids, sensitive: m.sensitive, partyId: m.party_id } : null,
      ctx: { userId: user.id, orgId: org.id, role, partyId: m?.party_id ?? null, sensitive: m?.sensitive ?? [] },
      sub: sub ? { state, planCode: sub.code, planName: sub.pname, limits: sub.limits, trialEndsAt: sub.trial_ends_at, periodEnd: sub.current_period_end, graceUntil: sub.grace_until, cancelAtEnd: sub.cancel_at_period_end } : null,
    };
  });
});

const overridesFor = cache(async (orgId: string, role: string): Promise<Overrides> => {
  const rows = await withTenant({ userId: '', orgId, role: 'system' }, q => many<any>(q, 'select permission, granted from role_permissions where org_id = $1 and role = $2', [orgId, role]));
  return Object.fromEntries(rows.map(r => [r.permission, r.granted]));
});
export async function hasPerm(s: SessionInfo, perm: string): Promise<boolean> {
  if (!s.ctx) return false;
  if (s.ctx.role === 'support') return perm.endsWith(':view') && !perm.startsWith('finance') && !perm.startsWith('safety');
  return canRole(s.ctx.role, perm, await overridesFor(s.ctx.orgId!, s.ctx.role));
}

export async function permSet(s: SessionInfo): Promise<Set<string>> {
  if (!s.ctx) return new Set();
  const { effective, MODULES, ACTIONS } = await import('./permissions');
  if (s.ctx.role === 'owner') return new Set(MODULES.flatMap(m => ACTIONS.map(a => `${m}:${a}`)));
  if (s.ctx.role === 'support') return new Set(MODULES.filter(m => !['finance', 'safety'].includes(m)).map(m => `${m}:view`));
  return new Set(effective(s.ctx.role, await overridesFor(s.ctx.orgId!, s.ctx.role)));
}

export type Result<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string; code?: string };

/** Subscription states in which writes are refused (data stays readable). */
export const READ_ONLY_STATES = ['expired', 'cancelled'];

/**
 * The single gate for server actions: session -> workspace -> suspended? -> read-only? -> permission -> idempotency -> transaction.
 */
export async function run<T>(opts: { perm?: string; write?: boolean; idem?: string | null; external?: boolean },
  fn: (a: { ctx: Ctx; q: Q; s: SessionInfo }) => Promise<T>, message?: string): Promise<Result<T>> {
  try {
    const s = await getSession();
    if (!s) return { ok: false, error: 'Your session has expired. Please sign in again.', code: 'expired' };
    if (!s.ctx || !s.org) return { ok: false, error: 'Choose a workspace first.', code: 'workspace' };
    if (['client', 'consultant', 'contractor'].includes(s.ctx.role) && !opts.external) return { ok: false, error: 'You do not have permission to do that.', code: 'denied' };
    if (s.ctx.role === 'support' && opts.write !== false) return { ok: false, error: 'Support access is read-only.', code: 'denied' };
    if (s.org.status === 'suspended') return { ok: false, error: 'This workspace is suspended. Contact support to restore access.', code: 'suspended' };
    if (opts.write !== false && s.sub && READ_ONLY_STATES.includes(s.sub.state)) {
      return { ok: false, error: 'Your subscription has ended, so this workspace is read-only. Renew your plan to make changes.', code: 'readonly' };
    }
    if (opts.perm && !(await hasPerm(s, opts.perm))) return { ok: false, error: 'You do not have permission to do that.', code: 'denied' };
    const sess = s as SessionInfo & { ctx: Ctx };
    const data = await withTenant(sess.ctx, async q => {
      if (opts.idem) {
        const r = await q.query('insert into idempotency_keys(key, user_id) values ($1,$2) on conflict do nothing', [opts.idem, sess.user.id]);
        if (r.rowCount === 0) throw new AppError('This was already submitted. Check the list before trying again.', 'duplicate');
      }
      return fn({ ctx: sess.ctx, q, s: sess });
    });
    return { ok: true, data, message };
  } catch (e) {
    const err = e as any;
    return { ok: false, error: friendly(e), code: err instanceof AppError ? err.code : err?.name === 'RuleError' ? err.code : undefined };
  }
}

export async function requireSession(): Promise<SessionInfo & { ctx: Ctx; org: NonNullable<SessionInfo['org']> }> {
  const s = await getSession();
  if (!s) redirect('/login?expired=1');
  if (s.pendingMfa) redirect('/login/verify');
  if (!s.ctx || !s.org) redirect(s.memberships.length ? '/workspaces' : s.user.platformRole ? '/platform' : '/workspaces');
  return s as any;
}
export { pool };
