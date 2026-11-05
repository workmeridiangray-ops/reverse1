import { type Ctx, type Q, AppError, many, one, audit, notify, need, needReason, nextNumber, milli, toNumeric, approvalAuthority } from './common';
import { checkMeasurement, checkSegregation, computeSubBill } from '../rules/subcontract';
import { lineAmount, sum } from '../rules/money';
import { ledgerBalance } from './contracts';

/** A work-order item must point at BOQ scope, and the total allocated across work orders cannot pass the BOQ quantity. */
export async function addWoItem(q: Q, ctx: Ctx, p: { workOrderId: string; boqItemId: string; rate: bigint; qtyLimit: bigint; tolBp: number }) {
  const wo = await one<any>(q, 'select * from work_orders where id = $1 for update', [p.workOrderId]);
  need(wo?.status === 'draft', 'Items can only be added while the work order is a draft.');
  const boq = await one<any>(q, 'select * from boq_items where id = $1 and project_id = $2 for update', [p.boqItemId, wo.project_id]);
  need(boq, 'That BOQ item is not part of this project.');
  const used = await one<any>(q, `select coalesce(sum(i.qty_limit),0) s from wo_items i join work_orders w on w.id = i.work_order_id where i.boq_item_id = $1 and w.status <> 'closed'`, [p.boqItemId]);
  need(milli(used!.s) + p.qtyLimit <= milli(boq.qty), `Only ${toNumeric(milli(boq.qty) - milli(used!.s))} ${boq.unit} of ${boq.code} remains to be subcontracted.`, 'over_scope');
  await q.query(`insert into wo_items(org_id, project_id, work_order_id, boq_item_id, description, unit, rate_paise, qty_limit, tolerance_bp, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [ctx.orgId, wo.project_id, p.workOrderId, p.boqItemId, boq.description, boq.unit, p.rate.toString(), toNumeric(p.qtyLimit), p.tolBp, ctx.userId]);
}

export async function cumulativeMeasured(q: Q, woItemId: string, excludeSheet?: string) {
  const r = await one<any>(q, `select coalesce(sum(l.qty),0) s from measurement_lines l join measurement_sheets s on s.id = l.sheet_id where l.wo_item_id = $1 and s.status <> 'rejected' and ($2::uuid is null or s.id <> $2)`, [woItemId, excludeSheet ?? null]);
  return milli(r!.s);
}
export async function addMeasurement(q: Q, ctx: Ctx, p: { sheetId: string; woItemId: string; location: string; measuredOn: string; qty: bigint }) {
  const sh = await one<any>(q, 'select * from measurement_sheets where id = $1 for update', [p.sheetId]);
  need(sh && ['draft', 'rejected'].includes(sh.status), 'Measurements can only be added to a draft sheet.');
  const it = await one<any>(q, 'select * from wo_items where id = $1 and work_order_id = $2', [p.woItemId, sh.work_order_id]);
  need(it, 'That item is not on this work order.');
  need(p.location.trim().length > 1, 'Enter the location measured.');
  const dup = await one<any>(q, 'select 1 from measurement_lines where wo_item_id = $1 and location = $2 and measured_on = $3', [p.woItemId, p.location.trim(), p.measuredOn]);
  need(!dup, 'This item has already been measured at this location on this date.', 'duplicate');
  checkMeasurement({ limitMilli: milli(it.qty_limit), tolBp: it.tolerance_bp, prevCumMilli: await cumulativeMeasured(q, p.woItemId), thisMilli: p.qty });
  await q.query(`insert into measurement_lines(org_id, project_id, sheet_id, wo_item_id, location, measured_on, qty, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.orgId, sh.project_id, p.sheetId, p.woItemId, p.location.trim(), p.measuredOn, toNumeric(p.qty), ctx.userId]);
}
export async function advanceSheet(q: Q, ctx: Ctx, sheetId: string, step: 'prepare' | 'verify' | 'approve' | 'reject', reason?: string) {
  const sh = await one<any>(q, 'select * from measurement_sheets where id = $1 for update', [sheetId]);
  need(sh, 'Sheet not found.');
  if (step === 'prepare') {
    need(['draft', 'rejected'].includes(sh.status), 'Only a draft sheet can be marked prepared.');
    const n = await one<any>(q, 'select count(*) n from measurement_lines where sheet_id = $1', [sheetId]); need(Number(n!.n) > 0, 'Add measurements first.');
    await q.query(`update measurement_sheets set status='prepared', prepared_by=$2, reject_reason=null where id=$1`, [sheetId, ctx.userId]);
  } else if (step === 'verify') {
    need(sh.status === 'prepared', 'The sheet must be prepared before it can be jointly verified.');
    checkSegregation(sh.prepared_by, null, ctx.userId, 'verify');
    await q.query(`update measurement_sheets set status='verified', verified_by=$2 where id=$1`, [sheetId, ctx.userId]);
  } else if (step === 'approve') {
    need(sh.status === 'verified', 'The sheet must be verified before approval.');
    checkSegregation(sh.prepared_by, sh.verified_by, ctx.userId, 'approve');
    await q.query(`update measurement_sheets set status='approved', approved_by=$2 where id=$1`, [sheetId, ctx.userId]);
  } else {
    need(['prepared', 'verified'].includes(sh.status), 'Only a prepared or verified sheet can be rejected.');
    needReason(reason, 'a reason for rejecting');
    await q.query(`update measurement_sheets set status='rejected', reject_reason=$2 where id=$1`, [sheetId, reason]);
    // rejected lines free up the cumulative quantity; re-opened as editable
  }
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `measurement.${step}`, entity: 'measurement_sheets', entityId: sheetId, detail: { reason } });
}

/** Sub bill from an approved sheet: one bill per sheet (the same measured work can never be billed twice). */
export async function createSubBill(q: Q, ctx: Ctx, p: { sheetId: string; materialRecovery: bigint; otherDeductions: bigint; deductionReason?: string }) {
  const sh = await one<any>(q, 'select * from measurement_sheets where id = $1 for update', [p.sheetId]);
  need(sh?.status === 'approved', 'Only an approved measurement sheet can be billed.');
  const wo = (await one<any>(q, 'select * from work_orders where id = $1', [sh.work_order_id]))!;
  const lines = await many<any>(q, `select l.qty, i.rate_paise from measurement_lines l join wo_items i on i.id = l.wo_item_id where l.sheet_id = $1`, [p.sheetId]);
  if (p.materialRecovery > 0n || p.otherDeductions > 0n) needReason(p.deductionReason, 'a reason for the deductions');
  const prior = await one<any>(q, `select coalesce(sum(advance_recovery_paise),0) s from sub_bills where work_order_id = $1`, [wo.id]);
  const outstanding = BigInt(wo.advance_paise) - BigInt(prior!.s);
  const calc = computeSubBill({ lines: lines.map(l => ({ qtyMilli: milli(l.qty), ratePaise: BigInt(l.rate_paise) })), retentionBp: wo.retention_bp, advanceOutstandingPaise: outstanding < 0n ? 0n : outstanding,
    advanceRecoveryBp: wo.advance_recovery_bp, materialRecoveryPaise: p.materialRecovery, otherDeductionsPaise: p.otherDeductions });
  const number = await nextNumber(q, ctx, sh.project_id, 'sb', 'SB');
  const bill = (await one<any>(q, `insert into sub_bills(org_id, project_id, work_order_id, sheet_id, number, gross_paise, retention_paise, advance_recovery_paise, material_recovery_paise, other_deductions_paise, deduction_reason, net_paise, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [ctx.orgId, sh.project_id, wo.id, p.sheetId, number, calc.gross.toString(), calc.retention.toString(), calc.advance.toString(), calc.material.toString(), calc.other.toString(), p.deductionReason ?? null, calc.net.toString(), ctx.userId]))!;
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'subbill.create', entity: 'sub_bills', entityId: bill.id });
  return bill;
}
export async function approveSubBill(q: Q, ctx: Ctx, billId: string) {
  const b = await one<any>(q, 'select * from sub_bills where id = $1 for update', [billId]);
  need(b?.status === 'draft', 'Only a draft sub-bill can be approved.');
  await approvalAuthority(q, ctx, b.project_id, 'po:approve', BigInt(b.net_paise));
  need(b.created_by !== ctx.userId || ['owner', 'manager'].includes(ctx.role), 'The person who prepared the bill cannot approve it.', 'segregation');
  await q.query(`update sub_bills set status='approved', approved_by=$2 where id=$1`, [billId, ctx.userId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'subbill.approve', entity: 'sub_bills', entityId: billId, detail: { net: b.net_paise } });
}
export async function workOrderPosition(q: Q, woId: string) {
  return many<any>(q, `select i.id, i.description, i.unit, i.qty_limit, i.tolerance_bp, i.rate_paise,
     coalesce((select sum(l.qty) from measurement_lines l join measurement_sheets s on s.id = l.sheet_id where l.wo_item_id = i.id and s.status <> 'rejected'),0) measured,
     coalesce((select sum(l.qty) from measurement_lines l join measurement_sheets s on s.id = l.sheet_id join sub_bills sb on sb.sheet_id = s.id where l.wo_item_id = i.id),0) billed
     from wo_items i where i.work_order_id = $1 order by i.created_at`, [woId]);
}
