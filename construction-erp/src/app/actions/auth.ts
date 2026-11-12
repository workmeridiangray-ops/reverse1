'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { FormState } from '@/components/ActionForm';
import { withSystem, withTenant, one, many, AppError, friendly } from '@/lib/db';
import * as id from '@/lib/identity';
import { COOKIE, clearSessionCookie, clientMeta, getSession, setSessionCookie } from '@/lib/session';
import { env } from '@/lib/env';
import { sha256, hashPassword, verifyPassword, passwordProblem } from '@/lib/crypto';
import { newSecret, verifyTotp, otpauthUri } from '@/lib/totp';
import { str, guard } from '@/lib/form';
import { audit } from '@/lib/audit';

const f = (e: unknown): FormState => ({ error: friendly(e) });

export async function signupAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    if (str(fd, 'terms') !== 'on') return { error: 'Please accept the terms to continue.' };
    const meta = await clientMeta();
    try {
      const r = await withSystem(async q => {
        const recent = await one<any>(q, `select count(*) n from login_attempts where ip = $1 and at > now() - interval '1 hour' and email like 'signup:%'`, [meta.ip]);
        if (Number(recent?.n ?? 0) >= 10) throw new AppError('Too many sign-ups from this network. Try again later.', 'rate');
        await q.query(`insert into login_attempts(email, ip, ok) values ($1,$2,true)`, ['signup:' + str(fd, 'email'), meta.ip]);
        return id.signUp(q, { name: str(fd, 'name'), email: str(fd, 'email'), password: String(fd.get('password') ?? ''), company: str(fd, 'company'), appUrl: env.appUrl });
      });
      return { ok: true, redirect: `/verify/sent?email=${encodeURIComponent(str(fd, 'email'))}` };
    } catch (e) { return f(e); }
  });
}

export async function resendVerificationAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, 'email');
  await withSystem(async q => {
    const u = await one<any>(q, 'select id, email_verified_at from users where lower(email) = $1', [id.normEmail(email)]);
    if (u && !u.email_verified_at) await id.sendVerification(q, u.id, email, env.appUrl);
  });
  return { ok: true, message: 'If that account needs verification, a new link is on its way.' };
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const meta = await clientMeta();
  const next = str(fd, 'next');
  const r = await withSystem(q => id.login(q, { email: str(fd, 'email'), password: String(fd.get('password') ?? ''), ip: meta.ip, ua: meta.ua, sessionDays: env.sessionDays }));
  if (!r.ok) return { error: r.error, code: r.code };
  await setSessionCookie(r.sessionToken);
  if (r.needsMfa) return { ok: true, redirect: '/login/verify' };
  return { ok: true, redirect: await landingFor(r.userId, next) };
}
async function landingFor(userId: string, next?: string) {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  const r = await withSystem(async q => {
    const u = await one<any>(q, 'select platform_role from users where id = $1', [userId]);
    const m = await many<any>(q, `select m.role from memberships m where m.user_id = $1 and m.status = 'active'`, [userId]);
    return { pr: u?.platform_role, m };
  });
  if (r.pr && r.m.length === 0) return '/platform';
  if (r.m.length === 0) return '/workspaces';
  return r.m.every(x => ['client', 'consultant', 'contractor'].includes(x.role)) ? '/portal' : '/dashboard';
}

export async function mfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession();
  if (!s) return { error: 'Your sign-in expired. Start again.', code: 'expired' };
  const ok = await withSystem(q => id.completeMfa(q, s.tokenHash, str(fd, 'code')));
  if (!ok) return { error: 'That code is not valid. Check your authenticator app and try again.' };
  return { ok: true, redirect: await landingFor(s.user.id) };
}

export async function logoutAction() {
  const s = await getSession();
  if (s) await withSystem(async q => { await q.query(`update sessions set revoked_at = now(), revoked_reason = 'logout' where id = $1`, [s.sessionId]); });
  await clearSessionCookie();
  redirect('/login?out=1');
}

export async function forgotAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, 'email');
  try { id.checkEmail(email); } catch (e) { return f(e); }
  await withSystem(async q => {
    const n = await one<any>(q, `select count(*) n from email_tokens t join users u on u.id = t.user_id where lower(u.email) = $1 and t.kind = 'reset' and t.created_at > now() - interval '1 hour'`, [id.normEmail(email)]);
    if (Number(n?.n ?? 0) < 5) await id.requestReset(q, email, env.appUrl);
  });
  // Same answer whether or not the account exists.
  return { ok: true, message: 'If an account exists for that email, a reset link has been sent. It is valid for 1 hour.' };
}
export async function resetAction(_: FormState, fd: FormData): Promise<FormState> {
  const pw = String(fd.get('password') ?? '');
  if (pw !== String(fd.get('confirm') ?? '')) return { error: 'The two passwords do not match.' };
  const r = await withSystem(q => id.resetPassword(q, str(fd, 'token'), pw));
  const msg = { weak: passwordProblem(pw) ?? 'Choose a stronger password.', expired: 'This reset link has expired. Request a new one.', invalid: 'This reset link is not valid or was already used. Request a new one.', ok: '' }[r];
  return r === 'ok' ? { ok: true, redirect: '/login?reset=1' } : { error: msg };
}

export async function acceptInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession();
  try {
    const r = await withSystem(q => id.acceptInvite(q, { token: str(fd, 'token'), name: str(fd, 'name'), password: String(fd.get('password') ?? ''), existingUserId: str(fd, 'existing') === '1' ? s?.user.id : undefined }));
    if (str(fd, 'existing') === '1' && s) { await withSystem(q => q.query('update sessions set org_id = $2 where id = $1', [s.sessionId, r.orgId])); return { ok: true, redirect: await landingFor(r.userId) }; }
    return { ok: true, redirect: '/login?joined=1' };
  } catch (e) { return f(e); }
}

export async function switchWorkspaceAction(fd: FormData) {
  const s = await getSession(); if (!s) redirect('/login');
  const orgId = str(fd, 'org');
  const ok = s.memberships.some(m => m.orgId === orgId) || s.user.platformRole === 'support';
  if (!ok) redirect('/denied');
  await withSystem(async q => { await q.query('update sessions set org_id = $2 where id = $1', [s.sessionId, orgId]); });
  const role = s.memberships.find(m => m.orgId === orgId)?.role;
  revalidatePath('/', 'layout');
  redirect(role && ['client', 'consultant', 'contractor'].includes(role) ? '/portal' : '/dashboard');
}

// ---- account & security -----------------------------------------------------------------------
export async function profileAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession(); if (!s) return { error: 'Session expired.', code: 'expired' };
  const name = str(fd, 'name'); if (name.length < 2) return { error: 'Enter your name.' };
  await withSystem(q => q.query('update users set name = $2 where id = $1', [s.user.id, name]));
  return { ok: true, message: 'Profile saved.' };
}
export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession(); if (!s) return { error: 'Session expired.', code: 'expired' };
  const np = String(fd.get('new') ?? ''); const prob = passwordProblem(np);
  if (prob) return { error: prob };
  if (np !== String(fd.get('confirm') ?? '')) return { error: 'The new passwords do not match.' };
  const u = await withSystem(q => one<any>(q, 'select password_hash from users where id = $1', [s.user.id]));
  if (!(await verifyPassword(String(fd.get('current') ?? ''), u!.password_hash))) return { error: 'Your current password is not correct.' };
  await withSystem(async q => {
    await q.query('update users set password_hash = $2 where id = $1', [s.user.id, await hashPassword(np)]);
    await q.query(`update sessions set revoked_at = now(), revoked_reason = 'password_changed' where user_id = $1 and id <> $2 and revoked_at is null`, [s.user.id, s.sessionId]);
    await audit(q, { orgId: s.org?.id ?? null, actorId: s.user.id, action: 'auth.password_changed' });
  });
  return { ok: true, message: 'Password changed. Your other devices have been signed out.' };
}
export async function startMfaAction(): Promise<{ secret: string; uri: string }> {
  const s = await getSession(); if (!s) throw new Error('expired');
  const secret = newSecret();
  await withSystem(q => q.query('update users set totp_secret = $2, totp_enabled = false where id = $1', [s.user.id, secret]));
  return { secret, uri: otpauthUri(s.user.email, secret) };
}
export async function enableMfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession(); if (!s) return { error: 'Session expired.', code: 'expired' };
  const u = await withSystem(q => one<any>(q, 'select totp_secret from users where id = $1', [s.user.id]));
  if (!u?.totp_secret || !verifyTotp(u.totp_secret, str(fd, 'code'))) return { error: 'That code did not match. Check the time on your phone and try again.' };
  await withSystem(async q => { await q.query('update users set totp_enabled = true where id = $1', [s.user.id]); await audit(q, { orgId: s.org?.id ?? null, actorId: s.user.id, action: 'auth.mfa_enabled' }); });
  return { ok: true, message: 'Two-factor sign-in is on.' };
}
export async function disableMfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession(); if (!s) return { error: 'Session expired.', code: 'expired' };
  if (s.user.platformRole) return { error: 'Platform staff must keep two-factor sign-in on.' };
  const u = await withSystem(q => one<any>(q, 'select password_hash from users where id = $1', [s.user.id]));
  if (!(await verifyPassword(String(fd.get('password') ?? ''), u!.password_hash))) return { error: 'Password is not correct.' };
  await withSystem(async q => { await q.query('update users set totp_enabled = false, totp_secret = null where id = $1', [s.user.id]); await audit(q, { orgId: s.org?.id ?? null, actorId: s.user.id, action: 'auth.mfa_disabled' }); });
  return { ok: true, message: 'Two-factor sign-in is off.' };
}
export async function revokeSessionAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession(); if (!s) return { error: 'Session expired.', code: 'expired' };
  const sid = str(fd, 'sid');
  await withSystem(q => q.query(`update sessions set revoked_at = now(), revoked_reason = 'user_revoked' where id = $1 and user_id = $2`, [sid, s.user.id]));
  if (sid === s.sessionId) { await clearSessionCookie(); return { ok: true, redirect: '/login?out=1' }; }
  return { ok: true, message: 'Session signed out.' };
}
export async function revokeOthersAction(_: FormState, __: FormData): Promise<FormState> {
  const s = await getSession(); if (!s) return { error: 'Session expired.', code: 'expired' };
  await withSystem(q => q.query(`update sessions set revoked_at = now(), revoked_reason = 'user_revoked_all' where user_id = $1 and id <> $2 and revoked_at is null`, [s.user.id, s.sessionId]));
  return { ok: true, message: 'All other sessions were signed out.' };
}
export async function notifPrefsAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await getSession(); if (!s) return { error: 'Session expired.', code: 'expired' };
  const prefs = { email_approvals: fd.get('email_approvals') === 'on', email_billing: fd.get('email_billing') === 'on', email_digest: fd.get('email_digest') === 'on' };
  await withSystem(q => q.query('update users set notify_prefs = $2 where id = $1', [s.user.id, JSON.stringify(prefs)]));
  return { ok: true, message: 'Preferences saved.' };
}
export async function markNotificationsReadAction() {
  const s = await getSession(); if (!s?.ctx) return;
  await withTenant(s.ctx, q => q.query('update notifications set read_at = now() where read_at is null'));
  revalidatePath('/', 'layout');
}
