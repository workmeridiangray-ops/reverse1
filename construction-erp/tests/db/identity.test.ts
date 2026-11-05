import { afterAll, describe, expect, it } from 'vitest';
import { withSystem, owner } from './helpers';
import { signUp, verifyEmail, login, requestReset, resetPassword, createInvitation, lookupInvite, acceptInvite, completeMfa } from '@/lib/identity';
import { newSecret, totp, verifyTotp, hotp } from '@/lib/totp';
import { sha256 } from '@/lib/crypto';
import { validateUpload } from '@/lib/storage';
import { verifyWebhookSignature, signWebhook } from '@/lib/payments';

afterAll(async () => { await owner.end(); });
const rnd = () => Math.random().toString(36).slice(2, 8);
const tokenFrom = (link: string) => link.split(/[=/]/).pop()!;

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vector', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
    expect(hotp(secret, Math.floor(59 / 30))).toBe('287082');
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '000000', 59_000)).toBe(false);
    const s = newSecret(); expect(verifyTotp(s, totp(s))).toBe(true);
  });
});

describe('sign-up, verification, login', () => {
  const email = `a-${rnd()}@test.example`;
  it('creates a trial workspace; login blocked until email verified', async () => {
    const r = await withSystem(q => signUp(q, { name: 'Asha', email, password: 'Passw0rd!!x', company: 'Asha Infra', appUrl: 'http://x' }));
    const sub = await withSystem(async q => (await q.query(`select status, trial_ends_at > now() as live from subscriptions where org_id = $1`, [r.orgId])).rows[0]);
    expect(sub).toMatchObject({ status: 'trialing', live: true });
    const l = await withSystem(q => login(q, { email, password: 'Passw0rd!!x', sessionDays: 1 }));
    expect(l).toMatchObject({ ok: false, code: 'unverified' });
    const mail = await withSystem(async q => (await q.query(`select body from email_outbox where to_email = $1`, [email])).rows[0].body as string);
    const token = mail.match(/token=([\w-]+)/)![1];
    expect(await withSystem(q => verifyEmail(q, 'bogus'))).toBe('invalid');
    expect(await withSystem(q => verifyEmail(q, token))).toBe('ok');
    expect(await withSystem(q => verifyEmail(q, token))).toBe('invalid');     // single use
    const ok = await withSystem(q => login(q, { email, password: 'Passw0rd!!x', sessionDays: 1 }));
    expect(ok.ok).toBe(true);
  });
  it('rejects duplicates and weak passwords with clear messages', async () => {
    await expect(withSystem(q => signUp(q, { name: 'Asha', email, password: 'Passw0rd!!x', company: 'Dup', appUrl: 'x' }))).rejects.toThrow(/already exists/);
    await expect(withSystem(q => signUp(q, { name: 'Bina R', email: `b-${rnd()}@t.example`, password: 'short', company: 'Co', appUrl: 'x' }))).rejects.toThrow(/10 characters/);
  });
  it('locks the account after repeated failures, without revealing which part was wrong', async () => {
    const e = `lock-${rnd()}@test.example`;
    const r = await withSystem(q => signUp(q, { name: 'Lata S', email: e, password: 'Passw0rd!!x', company: 'Lock Co', appUrl: 'x' }));
    await withSystem(q => q.query('update users set email_verified_at = now() where id = $1', [r.userId]));
    const unknown = await withSystem(q => login(q, { email: `nobody-${rnd()}@x.example`, password: 'whatever12345', sessionDays: 1 }));
    const wrong = await withSystem(q => login(q, { email: e, password: 'wrongpass12345', sessionDays: 1 }));
    expect(unknown).toMatchObject({ ok: false, error: (wrong as any).error });
    for (let i = 0; i < 5; i++) await withSystem(q => login(q, { email: e, password: 'wrongpass12345', sessionDays: 1 }));
    const locked = await withSystem(q => login(q, { email: e, password: 'Passw0rd!!x', sessionDays: 1 }));
    expect(locked).toMatchObject({ ok: false, code: 'locked' });
  });
});

describe('recovery', () => {
  it('reset link is single-use, expires, and revokes every session', async () => {
    const e = `rec-${rnd()}@test.example`;
    const r = await withSystem(q => signUp(q, { name: 'Ravi K', email: e, password: 'Passw0rd!!x', company: 'Rec Co', appUrl: 'x' }));
    await withSystem(q => q.query('update users set email_verified_at = now() where id = $1', [r.userId]));
    const l1 = await withSystem(q => login(q, { email: e, password: 'Passw0rd!!x', sessionDays: 1 })) as any;
    const link = (await withSystem(q => requestReset(q, e, 'http://x')))!;
    const token = tokenFrom(link);
    expect(await withSystem(q => requestReset(q, `ghost-${rnd()}@x.example`, 'http://x'))).toBeNull();
    expect(await withSystem(q => resetPassword(q, token, 'weak'))).toBe('weak');
    expect(await withSystem(q => resetPassword(q, token, 'BrandNew-pass-1'))).toBe('ok');
    expect(await withSystem(q => resetPassword(q, token, 'BrandNew-pass-2'))).toBe('invalid');
    const revoked = await withSystem(async q => (await q.query('select revoked_at from sessions where token_hash = $1', [sha256(l1.sessionToken)])).rows[0].revoked_at);
    expect(revoked).not.toBeNull();
    expect((await withSystem(q => login(q, { email: e, password: 'Passw0rd!!x', sessionDays: 1 }))).ok).toBe(false);
    expect((await withSystem(q => login(q, { email: e, password: 'BrandNew-pass-1', sessionDays: 1 }))).ok).toBe(true);
    const token2 = tokenFrom((await withSystem(q => requestReset(q, e, 'http://x')))!);
    await withSystem(q => q.query(`update email_tokens set expires_at = now() - interval '1 minute' where token_hash = $1`, [sha256(token2)]));
    expect(await withSystem(q => resetPassword(q, token2, 'BrandNew-pass-3'))).toBe('expired');
  });
});

describe('two-factor sign-in', () => {
  it('keeps the session pending until a valid code is given', async () => {
    const e = `mfa-${rnd()}@test.example`; const secret = newSecret();
    const r = await withSystem(q => signUp(q, { name: 'Meera N', email: e, password: 'Passw0rd!!x', company: 'Mfa Co', appUrl: 'x' }));
    await withSystem(q => q.query('update users set email_verified_at = now(), totp_secret = $2, totp_enabled = true where id = $1', [r.userId, secret]));
    const l = await withSystem(q => login(q, { email: e, password: 'Passw0rd!!x', sessionDays: 1 })) as any;
    expect(l.needsMfa).toBe(true);
    expect(await withSystem(q => completeMfa(q, sha256(l.sessionToken), '123456'))).toBe(false);
    expect(await withSystem(q => completeMfa(q, sha256(l.sessionToken), totp(secret)))).toBe(true);
    const s = await withSystem(async q => (await q.query('select pending_mfa from sessions where token_hash = $1', [sha256(l.sessionToken)])).rows[0]);
    expect(s.pending_mfa).toBe(false);
  });
});

describe('invitations', () => {
  it('have clear outcomes: valid, used, expired, revoked, wrong account, plan limit', async () => {
    const e = `own-${rnd()}@test.example`;
    const o = await withSystem(q => signUp(q, { name: 'Omar Q', email: e, password: 'Passw0rd!!x', company: 'Inv Co', appUrl: 'x' }));
    const mk = (email: string, role = 'engineer') => withSystem(q => createInvitation(q, { orgId: o.orgId, email, role, invitedBy: o.userId, appUrl: 'http://x', orgName: 'Inv Co' }));
    const inv1 = `i1-${rnd()}@test.example`;
    const t1 = tokenFrom(await mk(inv1));
    expect((await withSystem(q => lookupInvite(q, t1))).state).toBe('ok');
    const t1b = tokenFrom(await mk(inv1));                   // re-inviting revokes the earlier link
    expect((await withSystem(q => lookupInvite(q, t1))).state).toBe('revoked');
    await withSystem(q => acceptInvite(q, { token: t1b, name: 'Ivan', password: 'Passw0rd!!x' }));
    expect((await withSystem(q => lookupInvite(q, t1b))).state).toBe('used');
    await expect(withSystem(q => acceptInvite(q, { token: t1b, name: 'x', password: 'Passw0rd!!x' }))).rejects.toThrow(/used/);
    const t2 = tokenFrom(await mk(`i2-${rnd()}@test.example`));
    await withSystem(q => q.query(`update invitations set expires_at = now() - interval '1 hour' where token_hash = $1`, [sha256(t2)]));
    expect((await withSystem(q => lookupInvite(q, t2))).state).toBe('expired');
    expect((await withSystem(q => lookupInvite(q, 'nonsense'))).state).toBe('invalid');
    // wrong signed-in user
    const t3 = tokenFrom(await mk(`i3-${rnd()}@test.example`));
    await expect(withSystem(q => acceptInvite(q, { token: t3, existingUserId: o.userId }))).rejects.toThrow(/different email/);
    // plan limit (starter allows 5 users: owner + Ivan + 3 more)
    await withSystem(q => q.query(`update subscriptions set plan_id = (select id from plans where code='starter') where org_id = $1`, [o.orgId]));
    for (let i = 0; i < 3; i++) { const t = tokenFrom(await mk(`f${i}-${rnd()}@test.example`)); await withSystem(q => acceptInvite(q, { token: t, name: 'f', password: 'Passw0rd!!x' })); }
    const tl = tokenFrom(await mk(`late-${rnd()}@test.example`));
    await expect(withSystem(q => acceptInvite(q, { token: tl, name: 'late', password: 'Passw0rd!!x' }))).rejects.toThrow(/user limit/);
    // external invitees do not consume paid seats
    const te = tokenFrom(await mk(`cl-${rnd()}@test.example`, 'client'));
    await expect(withSystem(q => acceptInvite(q, { token: te, name: 'client', password: 'Passw0rd!!x' }))).resolves.toBeTruthy();
  });
});

describe('uploads and webhooks', () => {
  it('only allows listed types whose content matches, and bounded size', () => {
    const pdf = Buffer.from('%PDF-1.4 hi');
    expect(validateUpload('plan.pdf', 'application/pdf', pdf).safeName).toBe('plan.pdf');
    expect(() => validateUpload('evil.exe', 'application/x-msdownload', Buffer.from('MZ'))).toThrow(/not allowed/);
    expect(() => validateUpload('fake.pdf', 'application/pdf', Buffer.from('<html>'))).toThrow(/does not match/);
    expect(() => validateUpload('p.pdf', 'application/pdf', Buffer.alloc(0))).toThrow(/empty/);
    expect(() => validateUpload('p.pdf', 'application/pdf', Buffer.concat([pdf, Buffer.alloc(26 * 1024 * 1024)]))).toThrow(/larger/);
    expect(validateUpload('../../etc/passwd.pdf', 'application/pdf', pdf).safeName).not.toContain('/');
  });
  it('verifies webhook signatures', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    const sig = signWebhook(body, 'whsec'); 
    expect(verifyWebhookSignature(body, sig, 'whsec')).toBe(true);
    expect(verifyWebhookSignature(body + ' ', sig, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, null, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, sig, '')).toBe(false);
  });
});
