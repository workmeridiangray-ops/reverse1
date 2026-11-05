// Identity operations (no Next.js imports so they can be tested against a real database).
import type { Q } from './db';
import { AppError, many, one } from './db';
import { hashPassword, passwordProblem, randomToken, sha256, verifyPassword } from './crypto';
import { verifyTotp } from './totp';
import { queueMail } from './mail';
import { audit } from './audit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normEmail = (e: string) => e.trim().toLowerCase();
export function checkEmail(e: string) { if (!EMAIL_RE.test(e.trim())) throw new AppError('Enter a valid email address.', 'email'); }
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'company';

async function setting(q: Q, key: string, d: number) {
  const r = await one<{ value: any }>(q, 'select value from platform_settings where key = $1', [key]);
  return r ? Number(r.value) : d;
}

export async function signUp(q: Q, p: { name: string; email: string; password: string; company: string; appUrl: string }) {
  checkEmail(p.email);
  if (p.name.trim().length < 2) throw new AppError('Enter your name.', 'name');
  if (p.company.trim().length < 2) throw new AppError('Enter your company name.', 'company');
  const pw = passwordProblem(p.password); if (pw) throw new AppError(pw, 'password');
  const email = normEmail(p.email);
  if (await one(q, 'select 1 from users where lower(email) = $1', [email])) throw new AppError('An account with this email already exists. Sign in or recover your password.', 'exists');
  const user = (await one<{ id: string }>(q, 'insert into users(email, name, password_hash) values ($1,$2,$3) returning id', [email, p.name.trim(), await hashPassword(p.password)]))!;
  const slug = `${slugify(p.company)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  const org = (await one<{ id: string }>(q, `insert into orgs(name, slug, created_by, billing_email) values ($1,$2,$3,$4) returning id`, [p.company.trim(), slug, user.id, email]))!;
  await q.query(`insert into memberships(org_id, user_id, role) values ($1,$2,'owner')`, [org.id, user.id]);
  const plan = (await one<{ id: string }>(q, `select id from plans where code='growth' and retired_at is null order by version desc limit 1`))!;
  const trialDays = await setting(q, 'trial_days', 14);
  await q.query(`insert into subscriptions(org_id, plan_id, status, trial_ends_at) values ($1,$2,'trialing', now() + ($3 || ' days')::interval)`, [org.id, plan.id, String(trialDays)]);
  await sendVerification(q, user.id, email, p.appUrl);
  await audit(q, { orgId: org.id, actorId: user.id, action: 'org.created', entity: 'orgs', entityId: org.id });
  return { userId: user.id, orgId: org.id };
}

export async function sendVerification(q: Q, userId: string, email: string, appUrl: string) {
  const token = randomToken();
  await q.query(`update email_tokens set used_at = now() where user_id = $1 and kind = 'verify' and used_at is null`, [userId]);
  await q.query(`insert into email_tokens(user_id, kind, token_hash, expires_at) values ($1,'verify',$2, now() + interval '2 days')`, [userId, sha256(token)]);
  const link = `${appUrl}/verify?token=${token}`;
  await queueMail(q, email, 'Verify your Buildline email', `Welcome to Buildline.\n\nConfirm your email to activate your workspace:\n${link}\n\nThis link expires in 2 days. If you did not sign up, ignore this message.`);
  return link;
}

export async function verifyEmail(q: Q, token: string): Promise<'ok' | 'expired' | 'invalid'> {
  const t = await one<any>(q, 'select * from email_tokens where token_hash = $1 and kind = $2', [sha256(token), 'verify']);
  if (!t || t.used_at) return 'invalid';
  if (new Date(t.expires_at) < new Date()) return 'expired';
  await q.query('update email_tokens set used_at = now() where id = $1', [t.id]);
  await q.query('update users set email_verified_at = now() where id = $1 and email_verified_at is null', [t.user_id]);
  return 'ok';
}

export type LoginResult =
  | { ok: true; sessionToken: string; needsMfa: boolean; userId: string }
  | { ok: false; error: string; code?: string };

const MAX_FAILS = 5;
export async function login(q: Q, p: { email: string; password: string; ip?: string | null; ua?: string | null; sessionDays: number }): Promise<LoginResult> {
  const email = normEmail(p.email);
  const generic = 'Email or password is incorrect.';
  const user = await one<any>(q, 'select * from users where lower(email) = $1', [email]);
  const recent = await one<{ n: string }>(q, `select count(*) n from login_attempts where lower(email) = $1 and ok = false and at > now() - interval '15 minutes'`, [email]);
  if (user?.locked_until && new Date(user.locked_until) > new Date()) return { ok: false, error: 'Too many attempts. Try again in a few minutes or recover your password.', code: 'locked' };
  const good = user ? await verifyPassword(p.password, user.password_hash) : (await verifyPassword(p.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')), false);
  if (!user || !good) {
    await q.query('insert into login_attempts(email, ip, ok) values ($1,$2,false)', [email, p.ip ?? null]);
    if (user && Number(recent?.n ?? 0) + 1 >= MAX_FAILS) await q.query(`update users set locked_until = now() + interval '15 minutes' where id = $1`, [user.id]);
    return { ok: false, error: generic };
  }
  if (user.status === 'suspended') return { ok: false, error: 'This account is suspended. Contact your administrator.', code: 'suspended' };
  if (!user.email_verified_at) return { ok: false, error: 'Verify your email first — check your inbox for the link.', code: 'unverified' };
  await q.query('insert into login_attempts(email, ip, ok) values ($1,$2,true)', [email, p.ip ?? null]);
  await q.query('update users set failed_logins = 0, locked_until = null where id = $1', [user.id]);
  const token = randomToken();
  const needsMfa = !!user.totp_enabled;
  const last = await one<{ org_id: string }>(q, `select m.org_id from memberships m where m.user_id = $1 and m.status = 'active' order by m.created_at limit 1`, [user.id]);
  await q.query(
    `insert into sessions(user_id, token_hash, org_id, pending_mfa, mfa_verified, user_agent, ip, expires_at) values ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval)`,
    [user.id, sha256(token), last?.org_id ?? null, needsMfa, !needsMfa, p.ua?.slice(0, 200) ?? null, p.ip ?? null, String(p.sessionDays)],
  );
  await audit(q, { orgId: last?.org_id ?? null, actorId: user.id, action: 'auth.login', detail: { mfa: needsMfa }, ip: p.ip });
  return { ok: true, sessionToken: token, needsMfa, userId: user.id };
}

export async function completeMfa(q: Q, sessionTokenHash: string, code: string): Promise<boolean> {
  const s = await one<any>(q, `select s.*, u.totp_secret from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sessionTokenHash]);
  if (!s || !s.pending_mfa || !s.totp_secret) return false;
  if (!verifyTotp(s.totp_secret, code)) { await audit(q, { orgId: s.org_id, actorId: s.user_id, action: 'auth.mfa_failed' }); return false; }
  await q.query('update sessions set pending_mfa = false, mfa_verified = true where id = $1', [s.id]);
  return true;
}

export async function requestReset(q: Q, email: string, appUrl: string): Promise<string | null> {
  const user = await one<any>(q, 'select * from users where lower(email) = $1', [normEmail(email)]);
  if (!user) return null;     // caller shows the same message either way
  const token = randomToken();
  await q.query(`insert into email_tokens(user_id, kind, token_hash, expires_at) values ($1,'reset',$2, now() + interval '1 hour')`, [user.id, sha256(token)]);
  const link = `${appUrl}/reset?token=${token}`;
  await queueMail(q, user.email, 'Reset your Buildline password', `Use this link within 1 hour to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore it — your password has not changed.`);
  return link;
}

export async function resetPassword(q: Q, token: string, password: string): Promise<'ok' | 'expired' | 'invalid' | 'weak'> {
  if (passwordProblem(password)) return 'weak';
  const t = await one<any>(q, `select * from email_tokens where token_hash = $1 and kind = 'reset'`, [sha256(token)]);
  if (!t || t.used_at) return 'invalid';
  if (new Date(t.expires_at) < new Date()) return 'expired';
  await q.query('update email_tokens set used_at = now() where id = $1', [t.id]);
  await q.query(`update users set password_hash = $2, failed_logins = 0, locked_until = null, email_verified_at = coalesce(email_verified_at, now()) where id = $1`, [t.user_id, await hashPassword(password)]);
  await q.query(`update sessions set revoked_at = now(), revoked_reason = 'password_reset' where user_id = $1 and revoked_at is null`, [t.user_id]);
  await audit(q, { orgId: null, actorId: t.user_id, action: 'auth.password_reset' });
  return 'ok';
}

export async function revokeUserSessions(q: Q, userId: string, orgId: string | null, reason: string) {
  await q.query(`update sessions set revoked_at = now(), revoked_reason = $3 where user_id = $1 and revoked_at is null and ($2::uuid is null or org_id = $2)`, [userId, orgId, reason]);
}

// ---- invitations -----------------------------------------------------------------------------
export async function createInvitation(q: Q, p: { orgId: string; email: string; role: string; invitedBy: string; projectId?: string | null; partyId?: string | null; appUrl: string; orgName: string }) {
  checkEmail(p.email);
  const email = normEmail(p.email);
  await q.query(`update invitations set revoked_at = now() where org_id = $1 and lower(email) = $2 and accepted_at is null and revoked_at is null`, [p.orgId, email]);
  const token = randomToken();
  await q.query(`insert into invitations(org_id, email, role, project_id, party_id, token_hash, expires_at, invited_by) values ($1,$2,$3,$4,$5,$6, now() + interval '7 days', $7)`,
    [p.orgId, email, p.role, p.projectId ?? null, p.partyId ?? null, sha256(token), p.invitedBy]);
  const link = `${p.appUrl}/invite/${token}`;
  await queueMail(q, email, `You are invited to ${p.orgName} on Buildline`, `You have been invited as ${p.role}.\nAccept here (valid 7 days):\n${link}`, p.orgId);
  return link;
}
export type InviteState = { state: 'ok'; invite: any } | { state: 'expired' | 'revoked' | 'used' | 'invalid' };
export async function lookupInvite(q: Q, token: string): Promise<InviteState> {
  const i = await one<any>(q, `select i.*, o.name org_name from invitations i join orgs o on o.id = i.org_id where i.token_hash = $1`, [sha256(token)]);
  if (!i) return { state: 'invalid' };
  if (i.revoked_at) return { state: 'revoked' };
  if (i.accepted_at) return { state: 'used' };
  if (new Date(i.expires_at) < new Date()) return { state: 'expired' };
  return { state: 'ok', invite: i };
}
export async function acceptInvite(q: Q, p: { token: string; name?: string; password?: string; existingUserId?: string }): Promise<{ userId: string; orgId: string }> {
  const r = await lookupInvite(q, p.token);
  if (r.state !== 'ok') throw new AppError(`This invitation is ${r.state === 'invalid' ? 'not valid' : r.state}. Ask the sender for a new one.`, 'invite');
  const inv = r.invite;
  let userId = p.existingUserId ?? null;
  if (!userId) {
    const ex = await one<any>(q, 'select id from users where lower(email) = $1', [inv.email]);
    if (ex) throw new AppError('An account already exists for this email. Sign in first, then open the invitation again.', 'exists');
    const pw = passwordProblem(p.password ?? ''); if (pw) throw new AppError(pw, 'password');
    userId = (await one<{ id: string }>(q, `insert into users(email, name, password_hash, email_verified_at) values ($1,$2,$3, now()) returning id`, [inv.email, (p.name ?? '').trim() || inv.email, await hashPassword(p.password!)]))!.id;
  } else {
    const u = await one<any>(q, 'select email from users where id = $1', [userId]);
    if (normEmail(u.email) !== inv.email) throw new AppError('This invitation was sent to a different email address.', 'invite');
  }
  const sub = await one<any>(q, `select p.limits from subscriptions s join plans p on p.id = s.plan_id where s.org_id = $1`, [inv.org_id]);
  const isExt = ['client', 'consultant', 'contractor'].includes(inv.role);
  if (sub && !isExt) {
    const used = await one<any>(q, 'select org_usage($1) u', [inv.org_id]);
    if (used.u.users + 1 > sub.limits.users) throw new AppError('This workspace has reached its user limit. Ask the owner to upgrade the plan.', 'plan_limit');
  }
  await q.query(`insert into memberships(org_id, user_id, role, party_id) values ($1,$2,$3,$4)
                 on conflict (org_id, user_id) do update set role = excluded.role, status = 'active', party_id = excluded.party_id`, [inv.org_id, userId, inv.role, inv.party_id]);
  if (inv.project_id) {
    await q.query(`insert into project_members(org_id, project_id, user_id, project_role, party_id) values ($1,$2,$3,$4,$5) on conflict do nothing`, [inv.org_id, inv.project_id, userId, inv.role, inv.party_id]);
  }
  await q.query('update invitations set accepted_at = now() where id = $1', [inv.id]);
  await audit(q, { orgId: inv.org_id, actorId: userId, action: 'invite.accepted', entity: 'invitations', entityId: inv.id, detail: { role: inv.role } });
  return { userId, orgId: inv.org_id };
}

export async function listSessions(q: Q, userId: string) {
  return many(q, `select id, user_agent, ip, created_at, last_seen_at, revoked_at from sessions where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`, [userId]);
}
