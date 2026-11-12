'use server';
import type { FormState } from '@/components/ActionForm';
import { run, getSession } from '@/lib/session';
import { AppError, withSystem, one, many } from '@/lib/db';
import { state, str, opt, idem, guard } from '@/lib/form';
import { audit, need } from '@/lib/domain/common';
import * as ident from '@/lib/identity';
import * as saas from '@/lib/domain/saas';
import { createOrder, signWebhook } from '@/lib/payments';
import { env } from '@/lib/env';
import { MODULES, ACTIONS, INTERNAL_ROLES, SENSITIVE } from '@/lib/permissions';
import { checkEntitlement } from '@/lib/rules/plan';
import { randomToken, sha256 } from '@/lib/crypto';

export async function businessAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const gst = str(fd, 'gstin').toUpperCase(); if (gst && !/^[0-9A-Z]{15}$/.test(gst)) return { error: 'GSTIN must be 15 letters/digits.' };
    const color = str(fd, 'brand_color') || '#244B78'; if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'Brand colour must look like #244B78.' };
    return state(await run({ perm: 'settings:configure', idem: idem(fd) }, async ({ ctx, q }) => {
      await q.query(`update orgs set name=$2, legal_name=$3, gstin=$4, address=$5, state_code=$6, billing_email=$7, billing_address=$8, brand_color=$9, setup = setup || '{"branding":true}'::jsonb where id=$1`,
        [ctx.orgId, str(fd, 'name'), opt(fd, 'legal_name'), gst || null, opt(fd, 'address'), opt(fd, 'state_code'), opt(fd, 'billing_email'), opt(fd, 'billing_address'), color]);
      await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'org.update', entity: 'orgs', entityId: ctx.orgId! });
    }), { message: 'Business details saved.' });
  });
}
export async function activateAction(_: FormState, __: FormData): Promise<FormState> {
  return state(await run({ perm: 'settings:configure' }, async ({ ctx, q }) => { await q.query(`update orgs set setup = setup || '{"activated":true}'::jsonb where id=$1`, [ctx.orgId]); }), { message: 'Setup marked complete.' });
}
export async function addBranchAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ perm: 'settings:configure', idem: idem(fd) }, async ({ ctx, q, s }) => {
    const u = (await one<any>(q, 'select org_usage($1) u', [ctx.orgId]))!.u; if (s.sub) checkEntitlement(s.sub.limits, u, 'branches');
    await q.query('insert into branches(org_id, name, code, address) values ($1,$2,$3,$4)', [ctx.orgId, str(fd, 'name'), str(fd, 'code').toUpperCase(), opt(fd, 'address')]);
  }), { message: 'Branch added.' }));
}
export async function inviteAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ perm: 'team:create', idem: idem(fd) }, async ({ ctx, q, s }) => {
    const role = str(fd, 'role'); need(INTERNAL_ROLES.includes(role) && role !== 'owner', 'Choose a valid role.');
    if (s.sub) checkEntitlement(s.sub.limits, (await one<any>(q, 'select org_usage($1) u', [ctx.orgId]))!.u, 'users');
    await ident.createInvitation(q, { orgId: ctx.orgId!, email: str(fd, 'email'), role, invitedBy: ctx.userId, appUrl: env.appUrl, orgName: s.org!.name });
  }), { message: 'Invitation sent. It expires in 7 days.' }));
}
export async function revokeInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  return state(await run({ perm: 'team:edit' }, async ({ q }) => { await q.query('update invitations set revoked_at = now() where id = $1 and accepted_at is null', [str(fd, 'id')]); }), { message: 'Invitation cancelled. The link no longer works.' });
}
export async function memberAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ perm: 'team:edit', idem: idem(fd) }, async ({ ctx, q }) => {
    const id = str(fd, 'id'); const act = str(fd, 'act'); const m = await one<any>(q, 'select * from memberships where id=$1', [id]); need(m, 'Member not found.');
    need(m.user_id !== ctx.userId, 'You cannot change your own access.');
    need(m.role !== 'owner' || ctx.role === 'owner', 'Only an owner can change an owner.');
    if (act === 'role') { const role = str(fd, 'role'); need(INTERNAL_ROLES.includes(role) || ['client', 'consultant', 'contractor'].includes(role), 'Invalid role.'); await q.query('update memberships set role=$2 where id=$1', [id, role]); }
    else if (act === 'suspend' || act === 'remove') await q.query('update memberships set status=$2 where id=$1', [id, act === 'suspend' ? 'suspended' : 'removed']);
    else if (act === 'restore') await q.query(`update memberships set status='active' where id=$1`, [id]);
    else if (act === 'sensitive') await q.query('update memberships set sensitive=$2 where id=$1', [id, JSON.stringify(fd.getAll('sens').map(String).filter(x => (SENSITIVE as readonly string[]).includes(x)))]);
    else if (act === 'branches') await q.query('update memberships set branch_ids=$2 where id=$1', [id, fd.getAll('branch').map(String)]);
    else throw new AppError('Unknown action.');
    if (act !== 'sensitive' && act !== 'branches' && act !== 'restore') await ident.revokeUserSessions(q, m.user_id, ctx.orgId, `access_${act}`);   // access changes take effect immediately
    await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `member.${act}`, entity: 'memberships', entityId: id });
  }), { message: 'Access updated.' }));
}
export async function rolePermsAction(_: FormState, fd: FormData): Promise<FormState> {
  return state(await run({ perm: 'settings:configure' }, async ({ ctx, q }) => {
    const role = str(fd, 'role'); need(INTERNAL_ROLES.includes(role) && role !== 'owner', 'Choose a role other than owner.');
    const { ROLE_DEFAULTS } = await import('@/lib/permissions'); const want = new Set(fd.getAll('perm').map(String));
    await q.query('delete from role_permissions where org_id=$1 and role=$2', [ctx.orgId, role]);
    for (const m of MODULES) for (const a of ACTIONS) { const p = `${m}:${a}`; const def = (ROLE_DEFAULTS[role] ?? []).includes(p); if (want.has(p) !== def) await q.query('insert into role_permissions(org_id, role, permission, granted) values ($1,$2,$3,$4)', [ctx.orgId, role, p, want.has(p)]); }
    await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'role.edit', entity: 'role_permissions', detail: { role } });
  }), { message: 'Role updated.' });
}
export async function supportGrantAction(_: FormState, fd: FormData): Promise<FormState> {
  return state(await run({ perm: 'settings:configure', idem: idem(fd) }, async ({ ctx, q }) => {
    const act = str(fd, 'act');
    if (act === 'revoke') { await q.query('update support_grants set revoked_at=now() where id=$1', [str(fd, 'id')]); await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'support.revoke' }); return; }
    const g = await one<any>(q, `select * from support_grants where id=$1`, [str(fd, 'id')]); need(g, 'Request not found.');
    await q.query(`update support_grants set approved_by=$2, expires_at = now() + interval '24 hours' where id=$1`, [g.id, ctx.userId]);
    await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'support.approve', detail: { support_user: g.support_user_id } });
  }), { message: 'Updated.' });
}

// ---- billing ------------------------------------------------------------------------------------------
export async function checkoutAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ perm: 'finance:configure', idem: idem(fd) }, ({ ctx, q }) => saas.startCheckout(q, ctx.orgId!, ctx.userId, str(fd, 'plan'), str(fd, 'interval') === 'year' ? 'year' : 'month', opt(fd, 'coupon'), async (amt, rcpt) => createOrder(amt, rcpt))),
    { message: 'Invoice created. Complete the payment below.', redirect: r => `/settings/billing?pay=${r.invoice.id}` }));
}
/** Test mode only: sends a provider-signed style event through the same handler the real webhook uses. */
export async function simulatePaymentAction(invoiceId: string, outcome: 'ok' | 'fail', _: FormState, __: FormData): Promise<FormState> {
  if (env.paymentMode !== 'test') return { error: 'Test payments are disabled in this environment.' };
  return state(await run({ perm: 'finance:configure' }, async ({ ctx, q }) => {
    const p = await one<any>(q, `select * from platform_payments where invoice_id=$1 and status='pending'`, [invoiceId]); need(p, 'No pending payment for that invoice.');
    await withSystem(sq => saas.handlePaymentEvent(sq, { provider: p.provider, eventId: 'evt_' + randomToken(8), type: outcome === 'ok' ? 'payment.captured' : 'payment.failed', payload: { order_id: p.provider_ref, amount: p.amount_paise, error_description: 'Card declined (test)' } }));
  }), { message: outcome === 'ok' ? 'Test payment captured. Your plan is active.' : 'Test payment failed. You can retry.' });
}
export async function cancelAction(undo: boolean, _: FormState, __: FormData): Promise<FormState> {
  return state(await run({ perm: 'finance:configure', write: false }, ({ ctx, q }) => saas.cancelSubscription(q, ctx.orgId!, ctx.userId, undo)), { message: undo ? 'Cancellation withdrawn.' : 'Cancelled at the end of the current period. You keep access until then.' });
}
export async function downgradeAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ perm: 'finance:configure' }, ({ ctx, q }) => saas.scheduleDowngrade(q, ctx.orgId!, str(fd, 'plan'), str(fd, 'interval') === 'year' ? 'year' : 'month')), { message: 'Downgrade scheduled for the end of the current period.' }));
}
