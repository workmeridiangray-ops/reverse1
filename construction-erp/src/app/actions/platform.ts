'use server';
import type { FormState } from '@/components/ActionForm';
import { requirePlatform } from '@/lib/platform';
import { withTenant, withSystem, one, many, AppError, friendly } from '@/lib/db';
import { state, str, opt, int, money, guard } from '@/lib/form';
import { audit } from '@/lib/audit';
import { need, needReason } from '@/lib/domain/common';
import * as saas from '@/lib/domain/saas';
import { enqueue } from '@/lib/jobs';
import { revalidatePath } from 'next/cache';

async function plat<T>(area: any, fn: (c: any) => Promise<T>, msg: string): Promise<FormState> {
  return guard(async () => { const { ctx, s } = await requirePlatform(area); try { await withTenant(ctx, q => fn({ q, ctx, s })); revalidatePath('/platform', 'layout'); return { ok: true, message: msg }; } catch (e) { return { error: friendly(e) }; } });
}
export const orgStatusAction = async (_: FormState, fd: FormData) => plat('businesses', async ({ q, ctx }) => {
  const act = str(fd, 'act'); const id = str(fd, 'id'); needReason(str(fd, 'reason'), 'a reason');
  if (act === 'suspend') await q.query(`update orgs set status='suspended', suspended_reason=$2 where id=$1`, [id, str(fd, 'reason')]);
  else if (act === 'restore') await q.query(`update orgs set status='active', suspended_reason=null where id=$1`, [id]);
  else if (act === 'extend_trial') await q.query(`update subscriptions set trial_ends_at = coalesce(trial_ends_at, now()) + interval '7 days', status = case when status='expired' then 'trialing' else status end where org_id=$1`, [id]);
  else throw new AppError('Unknown action');
  if (act === 'suspend') await withSystem(sq => sq.query(`update sessions set revoked_at=now(), revoked_reason='org_suspended' where org_id=$1 and revoked_at is null`, [id]));
  await audit(q, { orgId: id, actorId: ctx.userId, role: 'platform', action: `platform.${act}`, entity: 'orgs', entityId: id, detail: { reason: str(fd, 'reason') } });
}, 'Done.');
export const supportAccessAction = async (_: FormState, fd: FormData) => plat('businesses', async ({ q, ctx, s }) => {
  need(s.user.platformRole === 'support' || s.user.platformRole === 'owner', 'Only support staff request access.'); needReason(str(fd, 'reason'), 'a reason for access');
  await q.query(`insert into support_grants(org_id, support_user_id, reason, approved_by, expires_at) values ($1,$2,$3,$2,now())`, [str(fd, 'id'), ctx.userId, str(fd, 'reason')]);   // expires immediately until the customer's owner approves
  await audit(q, { orgId: str(fd, 'id'), actorId: ctx.userId, role: 'platform', action: 'support.request', detail: { reason: str(fd, 'reason') } });
}, 'Access requested. The customer owner must approve it before you can view their workspace.');
export const refundAction = async (_: FormState, fd: FormData) => plat('billing', async ({ q, ctx }) => { await saas.refundPayment(q, ctx.userId, str(fd, 'id'), money(fd, 'amount'), str(fd, 'reason')); }, 'Refund recorded. Issue the refund at the payment provider using the reconciliation reference.');
export const couponAction = async (_: FormState, fd: FormData) => plat('billing', async ({ q, ctx }) => {
  await q.query('insert into coupons(code, percent_off, max_redemptions, expires_at) values ($1,$2,$3,$4)', [str(fd, 'code').toUpperCase(), int(fd, 'percent', 1, 100), opt(fd, 'max') ? int(fd, 'max', 1, 1e6) : null, opt(fd, 'expires')]);
  await audit(q, { orgId: null, actorId: ctx.userId, role: 'platform', action: 'coupon.create', detail: { code: str(fd, 'code') } });
}, 'Coupon created.');
export const planAction = async (_: FormState, fd: FormData) => plat('billing', async ({ q, ctx }) => {
  const code = str(fd, 'code'); const cur = await one<any>(q, 'select * from plans where code=$1 order by version desc limit 1', [code]); need(cur, 'Plan not found.');
  const limits = { users: int(fd, 'users', 1, 1e5), projects: int(fd, 'projects', 1, 1e5), storage_mb: int(fd, 'storage_mb', 1, 1e8), branches: int(fd, 'branches', 1, 1e4) };
  await q.query(`update plans set retired_at = current_date where id=$1 and retired_at is null`, [cur.id]);
  await q.query(`insert into plans(code, version, name, price_month_paise, price_year_paise, limits, features, effective_from) values ($1,$2,$3,$4,$5,$6,$7,current_date)`, [code, cur.version + 1, cur.name, money(fd, 'month').toString(), money(fd, 'year').toString(), JSON.stringify(limits), JSON.stringify(cur.features)]);
  await audit(q, { orgId: null, actorId: ctx.userId, role: 'platform', action: 'plan.new_version', detail: { code, version: cur.version + 1 } });
}, 'New plan version published. Existing invoices keep the version they were issued on.');
export const retryJobAction = async (_: FormState, fd: FormData) => plat('ops', async ({ q, ctx }) => {
  const r = await q.query(`update jobs set status='queued', attempts=0, run_at=now(), last_error=null where id=$1 and status='failed'`, [str(fd, 'id')]); need(r.rowCount, 'That job is not in a failed state.');
  await audit(q, { orgId: null, actorId: ctx.userId, role: 'platform', action: 'job.retry', entity: 'jobs', entityId: str(fd, 'id') });
}, 'Job re-queued. It will run at the next worker cycle.');
export const incidentAction = async (_: FormState, fd: FormData) => plat('ops', async ({ q }) => {
  if (str(fd, 'act') === 'resolve') { await q.query(`update incidents set status='resolved', resolved_at=now() where id=$1`, [str(fd, 'id')]); return; }
  await q.query('insert into incidents(title, severity, owner, notes) values ($1,$2,$3,$4)', [str(fd, 'title'), str(fd, 'severity') || 'minor', opt(fd, 'owner'), opt(fd, 'notes')]);
}, 'Incident updated.');
export const ticketAction = async (_: FormState, fd: FormData) => plat('ops', async ({ q }) => { needReason(str(fd, 'resolution'), 'a resolution'); await q.query(`update support_tickets set status='resolved', resolution=$2, resolved_at=now() where id=$1`, [str(fd, 'id'), str(fd, 'resolution')]); }, 'Ticket resolved.');
export const announceAction = async (_: FormState, fd: FormData) => plat('ops', async ({ q, ctx }) => { await q.query('insert into announcements(title, body, published_at, created_by) values ($1,$2,now(),$3)', [str(fd, 'title'), str(fd, 'body'), ctx.userId]); }, 'Published on the Updates page.');
export const staffAction = async (_: FormState, fd: FormData) => guard(async () => { const { s } = await requirePlatform('staff'); const role = str(fd, 'role');
  need(['owner', 'billing', 'support', 'techops', ''].includes(role), 'Invalid role.');
  const r = await withSystem(async q => { const u = await one<any>(q, 'select id from users where lower(email)=$1', [str(fd, 'email').toLowerCase()]); need(u, 'No user with that email — they must sign up first.'); need(u.id !== s.user.id, 'You cannot change your own platform role.'); await q.query('update users set platform_role=$2 where id=$1', [u.id, role || null]); await audit(q, { orgId: null, actorId: s.user.id, role: 'platform', action: 'platform.staff', detail: { user: u.id, role } }); if (!role) await q.query(`update sessions set revoked_at=now(), revoked_reason='platform_role_removed' where user_id=$1 and revoked_at is null`, [u.id]); }).then(() => null).catch(e => friendly(e));
  return r ? { error: r } : { ok: true, message: 'Platform role updated.' }; });
export const sweepAction = async (_: FormState, __: FormData) => plat('ops', async ({ q, ctx }) => { await enqueue(q, 'subscriptions.sweep', {}, { dedupeKey: `sweep:${new Date().toISOString().slice(0, 13)}` }); }, 'Subscription sweep queued.');
