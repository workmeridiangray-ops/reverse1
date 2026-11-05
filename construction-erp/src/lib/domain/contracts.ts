import { type Ctx, type Q, AppError, many, one, audit, need, needReason } from './common';
import { lineAmount, bpOf, sum } from '../rules/money';
import { milli } from './common';

export async function contractValue(q: Q, projectId: string) {
  const items = await many<any>(q, 'select qty, rate_paise from boq_items where project_id = $1', [projectId]);
  return sum(items.map(i => lineAmount(milli(i.qty), BigInt(i.rate_paise))));
}

/** Activating snapshots the commercial basis: later BOQ/rate edits cannot silently rewrite what was agreed. */
export async function activateContract(q: Q, ctx: Ctx, contractId: string) {
  const c = await one<any>(q, 'select * from contracts where id = $1 for update', [contractId]);
  need(c, 'Contract not found.'); need(c.status === 'draft', 'This contract is already active.');
  const act = await one<any>(q, `select 1 from contracts where project_id = $1 and status = 'active'`, [c.project_id]);
  need(!act, 'This project already has an active contract (one agreed contract per project).');
  const items = await many<any>(q, 'select code, description, unit, qty, rate_paise from boq_items where project_id = $1 order by code', [c.project_id]);
  need(items.length > 0, 'The project has no BOQ to contract against.');
  const value = await contractValue(q, c.project_id);
  const snapshot = { boq: items, terms: { advance_bp: c.advance_bp, advance_recovery_bp: c.advance_recovery_bp, retention_bp: c.retention_bp, security_deposit_bp: c.security_deposit_bp, payment_days: c.payment_days }, value: value.toString(), at: new Date().toISOString() };
  await q.query(`update contracts set status = 'active', value_paise = $2, snapshot = $3, approved_at = now(), approved_by = $4 where id = $1`, [contractId, value.toString(), JSON.stringify(snapshot), ctx.userId]);
  await q.query(`update projects set status = 'active' where id = $1 and status = 'planning'`, [c.project_id]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'contract.activate', entity: 'contracts', entityId: contractId, detail: { value: value.toString() } });
}

export async function ledgerBalance(q: Q, contractId: string) {
  const rows = await many<any>(q, 'select kind, sum(amount_paise) s from contract_ledger where contract_id = $1 group by kind', [contractId]);
  const g = (k: string) => BigInt(rows.find(r => r.kind === k)?.s ?? 0);
  return { advancePaid: g('advance_paid'), advanceRecovered: g('advance_recovered'), advanceOutstanding: g('advance_paid') - g('advance_recovered'),
    retentionHeld: g('retention_held') - g('retention_released'), securityHeld: g('security_held') - g('security_released') };
}

export async function recordAdvance(q: Q, ctx: Ctx, contractId: string, amount: bigint) {
  const c = await one<any>(q, 'select * from contracts where id = $1 for update', [contractId]);
  need(c?.status === 'active', 'The contract must be active to record an advance.');
  const max = bpOf(BigInt(c.value_paise), c.advance_bp);
  const bal = await ledgerBalance(q, contractId);
  need(amount > 0n, 'Enter an amount greater than zero.');
  need(bal.advancePaid + amount <= max, `The contract allows an advance of up to ${max / 100n} rupees in total.`);
  await q.query(`insert into contract_ledger(org_id, project_id, contract_id, kind, amount_paise, note, created_by) values ($1,$2,$3,'advance_paid',$4,'Advance received',$5)`, [ctx.orgId, c.project_id, contractId, amount.toString(), ctx.userId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'contract.advance', entity: 'contracts', entityId: contractId, detail: { amount: amount.toString() } });
}

export async function releaseRetention(q: Q, ctx: Ctx, contractId: string, amount: bigint, reason: string) {
  const c = await one<any>(q, 'select * from contracts where id = $1 for update', [contractId]);
  need(c, 'Contract not found.'); needReason(reason, 'a reason for releasing retention');
  const bal = await ledgerBalance(q, contractId);
  need(amount > 0n && amount <= bal.retentionHeld, 'You can only release retention that is currently held.');
  await q.query(`insert into contract_ledger(org_id, project_id, contract_id, kind, amount_paise, note, created_by) values ($1,$2,$3,'retention_released',$4,$5,$6)`, [ctx.orgId, c.project_id, contractId, amount.toString(), reason, ctx.userId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'contract.retention_release', entity: 'contracts', entityId: contractId, detail: { amount: amount.toString(), reason } });
}

export async function approveAmendment(q: Q, ctx: Ctx, amendmentId: string) {
  const a = await one<any>(q, 'select * from contract_amendments where id = $1 for update', [amendmentId]);
  need(a, 'Amendment not found.'); need(a.status === 'draft', 'Already approved.');
  await q.query(`update contract_amendments set status = 'approved' where id = $1`, [amendmentId]);
  await q.query(`update contracts set value_paise = value_paise + $2 where id = $1`, [a.contract_id, a.delta_paise]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'contract.amendment', entity: 'contract_amendments', entityId: amendmentId, detail: { delta: a.delta_paise } });
}
