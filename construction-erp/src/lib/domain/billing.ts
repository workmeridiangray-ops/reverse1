import { type Ctx, type Q, AppError, many, one, audit, notify, need, needReason, nextNumber, milli, toNumeric, approvalAuthority, projectMembers, ZERO_SCOPE } from './common';
import { computeBill, invoiceStatus, variationCost, finalAccount, type BillLineInput } from '../rules/billing';
import { lineAmount, sum, divRound } from '../rules/money';
import { ledgerBalance } from './contracts';

// ---- Measurement book -------------------------------------------------------------------------------
export async function addMeasurementBook(q: Q, ctx: Ctx, p: { projectId: string; boqItemId: string; location: string; measuredOn: string; qty: bigint; note?: string }) {
  const b = await one<any>(q, 'select * from boq_items where id = $1 and project_id = $2', [p.boqItemId, p.projectId]); need(b, 'BOQ item not found on this project.');
  need(p.qty > 0n, 'Enter a quantity greater than zero.'); need(p.location.trim().length > 1, 'Enter the location measured.');
  const dup = await one<any>(q, 'select 1 from measurement_book where boq_item_id = $1 and location = $2 and measured_on = $3', [p.boqItemId, p.location.trim(), p.measuredOn]);
  need(!dup, 'This item is already recorded at this location on this date (duplicate measurement).', 'duplicate');
  await q.query(`insert into measurement_book(org_id, project_id, boq_item_id, location, measured_on, qty, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.orgId, p.projectId, p.boqItemId, p.location.trim(), p.measuredOn, toNumeric(p.qty), p.note ?? null, ctx.userId]);
}
export async function verifyMeasurementBook(q: Q, ctx: Ctx, id: string) {
  const m = await one<any>(q, 'select * from measurement_book where id = $1 for update', [id]);
  need(m?.status === 'draft', 'Only a draft entry can be verified.');
  need(m.created_by !== ctx.userId || ['owner', 'manager'].includes(ctx.role), 'Someone other than the recorder must verify a measurement.', 'segregation');
  await q.query(`update measurement_book set status = 'verified', verified_by = $2 where id = $1`, [id, ctx.userId]);
}

// ---- Running account bills ---------------------------------------------------------------------------
async function priorState(q: Q, contractId: string, excludeBillId?: string) {
  const rows = await many<any>(q, `select * from ra_bills where contract_id = $1 and status in ('certified','invoiced') and ($2::uuid is null or id <> $2) order by bill_no desc limit 1`, [contractId, excludeBillId ?? null]);
  const last = rows[0];
  const bal = await ledgerBalance(q, contractId);
  return { cumGrossPaise: BigInt(last?.certified_gross_paise ?? 0), cumAdvanceRecoveredPaise: BigInt(last?.advance_recovery_paise ?? 0), cumRetentionPaise: BigInt(last?.retention_paise ?? 0), advancePaidPaise: bal.advancePaid };
}
async function prevCumByItem(q: Q, contractId: string, billId?: string): Promise<Map<string, bigint>> {
  const rows = await many<any>(q, `select l.boq_item_id, sum(coalesce(l.certified_this_qty, l.this_qty)) s from ra_bill_lines l join ra_bills b on b.id = l.bill_id
     where b.contract_id = $1 and b.status in ('certified','invoiced') and ($2::uuid is null or b.id <> $2) group by 1`, [contractId, billId ?? null]);
  return new Map(rows.map(r => [r.boq_item_id, milli(r.s)]));
}

/** Build the next bill from VERIFIED measurement-book entries that have not been billed. */
export async function createBill(q: Q, ctx: Ctx, contractId: string, periodTo: string) {
  const c = await one<any>(q, 'select * from contracts where id = $1 for update', [contractId]);
  need(c?.status === 'active', 'The contract must be active before billing.');
  const open = await one<any>(q, `select bill_no from ra_bills where contract_id = $1 and status in ('draft','submitted') limit 1`, [contractId]);
  need(!open, `Bill ${open?.bill_no} is still open. Finish (certify or reject) it before starting the next.`, 'open_bill');
  const entries = await many<any>(q, `select boq_item_id, sum(qty) s from measurement_book where project_id = $1 and status = 'verified' and bill_id is null and measured_on <= $2 group by 1`, [c.project_id, periodTo]);
  need(entries.length > 0, 'There are no verified, unbilled measurements up to that date.');
  const no = Number((await one<any>(q, 'select coalesce(max(bill_no),0)+1 n from ra_bills where contract_id = $1', [contractId]))!.n);
  const prev = await prevCumByItem(q, contractId);
  const boq = new Map((await many<any>(q, 'select * from boq_items where project_id = $1', [c.project_id])).map(b => [b.id, b]));
  const inputs: BillLineInput[] = entries.map(e => { const b = boq.get(e.boq_item_id); return { boqItemId: e.boq_item_id, ratePaise: BigInt(b.rate_paise), boqQtyMilli: milli(b.qty), prevCumMilli: prev.get(e.boq_item_id) ?? 0n, thisMilli: milli(e.s) }; });
  const calc = computeBill(inputs, { advanceRecoveryBp: c.advance_recovery_bp, retentionBp: c.retention_bp }, await priorState(q, contractId));
  const bill = (await one<any>(q, `insert into ra_bills(org_id, project_id, contract_id, bill_no, period_to, submitted_paise, certified_gross_paise, prev_certified_gross_paise, advance_recovery_paise, retention_paise, net_certified_paise, created_by)
     values ($1,$2,$3,$4,$5,$6,0,$7,0,0,0,$8) returning *`, [ctx.orgId, c.project_id, contractId, no, periodTo, calc.submittedPaise.toString(), (await priorState(q, contractId)).cumGrossPaise.toString(), ctx.userId]))!;
  for (const l of calc.lines) {
    await q.query(`insert into ra_bill_lines(org_id, project_id, bill_id, boq_item_id, rate_paise, prev_cum_qty, this_qty, amount_submitted_paise, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.orgId, c.project_id, bill.id, l.boqItemId, l.ratePaise.toString(), toNumeric(l.prevCumMilli), toNumeric(l.thisMilli), l.amountSubmitted.toString(), ctx.userId]);
  }
  await q.query(`update measurement_book set bill_id = $1, status = 'billed' where project_id = $2 and status = 'verified' and bill_id is null and measured_on <= $3`, [bill.id, c.project_id, periodTo]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'bill.create', entity: 'ra_bills', entityId: bill.id, detail: { bill_no: no } });
  return bill;
}

export async function submitBill(q: Q, ctx: Ctx, billId: string) {
  const b = await one<any>(q, 'select * from ra_bills where id = $1 for update', [billId]);
  need(b?.status === 'draft', 'Only a draft bill can be submitted.');
  await q.query(`update ra_bills set status = 'submitted' where id = $1`, [billId]);
  const ext = await many<any>(q, `select pm.user_id from project_members pm join memberships m on m.user_id = pm.user_id and m.org_id = pm.org_id where pm.project_id = $1 and m.role in ('client','consultant') and pm.effective_to is null`, [b.project_id]);
  await notify(q, ctx.orgId!, ext.map(e => e.user_id), `Running bill ${b.bill_no} awaits your certification`, '', `/portal/${b.project_id}/bills/${billId}`);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'bill.submit', entity: 'ra_bills', entityId: billId });
}

/** Certification with optional partial quantities. Used by external certifiers (portal) and by QS recording a certificate. */
export async function certifyBill(q: Q, ctx: Ctx, billId: string, certified: Record<string, string> | null, ref: string | null, reduceReason?: string) {
  const b = await one<any>(q, 'select * from ra_bills where id = $1 for update', [billId]);
  need(b?.status === 'submitted', 'This bill is not awaiting certification.');
  if (!['client', 'consultant'].includes(ctx.role)) needReason(ref, 'the certificate reference'); else await approvalAuthority(q, ctx, b.project_id, 'bill:certify', BigInt(b.submitted_paise));
  const c = (await one<any>(q, 'select * from contracts where id = $1', [b.contract_id]))!;
  const lines = await many<any>(q, 'select * from ra_bill_lines where bill_id = $1', [billId]);
  const boq = new Map((await many<any>(q, 'select * from boq_items where project_id = $1', [b.project_id])).map(x => [x.id, x]));
  const inputs: BillLineInput[] = lines.map(l => ({ boqItemId: l.boq_item_id, ratePaise: BigInt(l.rate_paise), boqQtyMilli: milli(boq.get(l.boq_item_id).qty), prevCumMilli: milli(l.prev_cum_qty), thisMilli: milli(l.this_qty),
    certifiedThisMilli: certified && certified[l.id] !== undefined ? milli(certified[l.id]) : milli(l.this_qty) }));
  const reduced = inputs.some(i => i.certifiedThisMilli! < i.thisMilli);
  if (reduced) needReason(reduceReason, 'a reason for certifying less than claimed');
  const calc = computeBill(inputs, { advanceRecoveryBp: c.advance_recovery_bp, retentionBp: c.retention_bp }, await priorState(q, b.contract_id, billId));
  for (let i = 0; i < lines.length; i++) {
    await q.query('update ra_bill_lines set certified_this_qty = $2, amount_certified_paise = $3 where id = $1', [lines[i].id, toNumeric(calc.lines[i].certifiedMilli), calc.lines[i].amountCertified.toString()]);
  }
  await q.query(`update ra_bills set status='certified', certified_gross_paise=$2, advance_recovery_paise=$3, retention_paise=$4, net_certified_paise=$5, certified_by=$6, certified_at=now(), certificate_ref=$7, reject_reason=$8 where id=$1`,
    [billId, calc.cumGrossPaise.toString(), calc.cumAdvanceRecoveryPaise.toString(), calc.cumRetentionPaise.toString(), calc.netPayablePaise.toString(), ctx.userId, ref, reduced ? reduceReason : null]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'bill.certify', entity: 'ra_bills', entityId: billId, detail: { partial: reduced, reason: reduceReason, net: calc.netPayablePaise.toString() } });
  return calc;
}
export async function rejectBill(q: Q, ctx: Ctx, billId: string, reason: string) {
  const b = await one<any>(q, 'select * from ra_bills where id = $1 for update', [billId]);
  need(b?.status === 'submitted', 'This bill is not awaiting certification.'); needReason(reason, 'a reason for rejecting the bill');
  await q.query(`update ra_bills set status='rejected', reject_reason=$2 where id=$1`, [billId, reason]);
  await q.query(`update measurement_book set status='verified', bill_id=null where bill_id=$1`, [billId]);   // quantities become billable again
  if (b.created_by) await notify(q, ctx.orgId!, [b.created_by], `Bill ${b.bill_no} was rejected`, reason, `/p/${b.project_id}/ra_bills/${billId}`);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'bill.reject', entity: 'ra_bills', entityId: billId, detail: { reason } });
}

export async function invoiceBill(q: Q, ctx: Ctx, billId: string) {
  const b = await one<any>(q, 'select * from ra_bills where id = $1 for update', [billId]);
  need(b?.status === 'certified', 'Only a certified bill can be invoiced.');
  const c = (await one<any>(q, 'select * from contracts where id = $1', [b.contract_id]))!;
  const number = await nextNumber(q, ctx, ZERO_SCOPE, 'invoice', `INV-${new Date().getFullYear()}`, 5);
  const inv = (await one<any>(q, `insert into invoices(org_id, project_id, bill_id, number, amount_paise, due_date, created_by) values ($1,$2,$3,$4,$5, current_date + $6::int, $7) returning *`,
    [ctx.orgId, b.project_id, billId, number, b.net_certified_paise, c.payment_days, ctx.userId]))!;
  const prev = await one<any>(q, `select coalesce(sum(case when kind='advance_recovered' then amount_paise end),0) a, coalesce(sum(case when kind='retention_held' then amount_paise end),0) r from contract_ledger where contract_id = $1`, [b.contract_id]);
  const dAdv = BigInt(b.advance_recovery_paise) - BigInt(prev!.a), dRet = BigInt(b.retention_paise) - BigInt(prev!.r);
  if (dAdv > 0n) await q.query(`insert into contract_ledger(org_id, project_id, contract_id, kind, amount_paise, ref_type, ref_id, created_by) values ($1,$2,$3,'advance_recovered',$4,'ra_bill',$5,$6)`, [ctx.orgId, b.project_id, b.contract_id, dAdv.toString(), billId, ctx.userId]);
  if (dRet > 0n) await q.query(`insert into contract_ledger(org_id, project_id, contract_id, kind, amount_paise, ref_type, ref_id, created_by) values ($1,$2,$3,'retention_held',$4,'ra_bill',$5,$6)`, [ctx.orgId, b.project_id, b.contract_id, dRet.toString(), billId, ctx.userId]);
  await q.query(`update ra_bills set status = 'invoiced', invoiced_at = now() where id = $1`, [billId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'invoice.create', entity: 'invoices', entityId: inv.id, detail: { amount: inv.amount_paise } });
  return inv;
}

// ---- Collections ----------------------------------------------------------------------------------------
async function refreshInvoice(q: Q, invId: string) {
  const inv = (await one<any>(q, 'select * from invoices where id = $1', [invId]))!;
  const col = await one<any>(q, 'select coalesce(sum(amount_paise),0) s from receipts where invoice_id = $1', [invId]);
  const dis = await one<any>(q, `select coalesce(sum(amount_paise),0) s from disputes where invoice_id = $1 and status = 'open'`, [invId]);
  const wo = await one<any>(q, `select coalesce(sum(amount_paise),0) s from disputes where invoice_id = $1 and status = 'written_off'`, [invId]);
  const st = invoiceStatus(BigInt(inv.amount_paise), BigInt(col!.s), BigInt(dis!.s), BigInt(wo!.s));
  await q.query('update invoices set collected_paise = $2, written_off_paise = $4, status = $3 where id = $1', [invId, col!.s, st, wo!.s]);
  return st;
}
export async function recordReceipt(q: Q, ctx: Ctx, p: { invoiceId: string; amount: bigint; receivedOn: string; method: string; reference: string }) {
  const inv = await one<any>(q, 'select * from invoices where id = $1 for update', [p.invoiceId]);
  need(inv, 'Invoice not found.'); need(p.amount > 0n, 'Enter an amount greater than zero.'); need(p.reference.trim().length >= 2, 'Enter the bank or cheque reference.');
  const out = BigInt(inv.amount_paise) - BigInt(inv.collected_paise) - BigInt(inv.written_off_paise);
  need(p.amount <= out, `Only ${out / 100n} rupees is outstanding on this invoice.`, 'overpay');
  const dup = await one<any>(q, 'select 1 from receipts where invoice_id = $1 and reference = $2', [p.invoiceId, p.reference.trim()]);
  need(!dup, 'A receipt with this reference was already recorded for this invoice.', 'duplicate');
  await q.query(`insert into receipts(org_id, project_id, invoice_id, amount_paise, received_on, method, reference, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [ctx.orgId, inv.project_id, p.invoiceId, p.amount.toString(), p.receivedOn, p.method, p.reference.trim(), ctx.userId]);
  const st = await refreshInvoice(q, p.invoiceId);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'receipt.create', entity: 'receipts', detail: { invoice: p.invoiceId, amount: p.amount.toString() } });
  return st;
}
export async function raiseDispute(q: Q, ctx: Ctx, invoiceId: string, amount: bigint, reason: string) {
  const inv = await one<any>(q, 'select * from invoices where id = $1 for update', [invoiceId]); need(inv, 'Invoice not found.');
  needReason(reason, 'the reason for the dispute');
  need(amount > 0n && amount <= BigInt(inv.amount_paise) - BigInt(inv.collected_paise) - BigInt(inv.written_off_paise), 'The disputed amount must be within the outstanding balance.');
  await q.query(`insert into disputes(org_id, project_id, invoice_id, amount_paise, reason, created_by) values ($1,$2,$3,$4,$5,$6)`, [ctx.orgId, inv.project_id, invoiceId, amount.toString(), reason, ctx.userId]);
  await refreshInvoice(q, invoiceId);
}
export async function resolveDispute(q: Q, ctx: Ctx, disputeId: string, outcome: 'resolved' | 'written_off', resolution: string) {
  const d = await one<any>(q, 'select * from disputes where id = $1 for update', [disputeId]);
  need(d?.status === 'open', 'This dispute is already closed.');
  if (outcome === 'written_off') need(['owner', 'manager'].includes(ctx.role), 'Only a manager can write off a disputed amount.', 'authority');
  needReason(resolution, 'a resolution note');
  await q.query('update disputes set status = $2, resolution = $3 where id = $1', [disputeId, outcome, resolution]);
  if (outcome === 'written_off') {
    await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'dispute.write_off', entity: 'disputes', entityId: disputeId, detail: { amount: d.amount_paise, reason: resolution } });
  }
  await refreshInvoice(q, d.invoice_id);
}

// ---- Variations --------------------------------------------------------------------------------------------
export async function saveVariationItems(q: Q, ctx: Ctx, variationId: string, items: { code: string; description: string; unit: string; qty: bigint; rate: bigint; baseBoqItemId?: string | null }[]) {
  const v = await one<any>(q, 'select * from variations where id = $1 for update', [variationId]); need(v?.status === 'draft', 'Only a draft variation can be edited.');
  await q.query('delete from variation_items where variation_id = $1', [variationId]);
  const vi = [];
  for (const i of items) {
    let rate = i.rate;
    let baseRate: bigint | undefined;
    if (i.baseBoqItemId) { const b = await one<any>(q, 'select rate_paise from boq_items where id = $1 and project_id = $2', [i.baseBoqItemId, v.project_id]); need(b, 'Base BOQ item not found.'); baseRate = BigInt(b.rate_paise); rate = baseRate; }
    vi.push({ qtyMilli: i.qty, ratePaise: rate, baseRatePaise: baseRate });
    await q.query(`insert into variation_items(org_id, project_id, variation_id, code, description, unit, qty, rate_paise, base_boq_item_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ctx.orgId, v.project_id, variationId, i.code, i.description, i.unit, toNumeric(i.qty), rate.toString(), i.baseBoqItemId ?? null, ctx.userId]);
  }
  const cost = variationCost(vi);
  await q.query('update variations set cost_delta_paise = $2 where id = $1', [variationId, cost.toString()]);
  return cost;
}
export async function submitVariation(q: Q, ctx: Ctx, id: string) {
  const v = await one<any>(q, 'select * from variations where id = $1 for update', [id]); need(v?.status === 'draft', 'Only a draft variation can be submitted.');
  const n = await one<any>(q, 'select count(*) n from variation_items where variation_id = $1', [id]); need(Number(n!.n) > 0 || v.time_delta_days !== 0, 'Add items or a time impact first.');
  await q.query(`update variations set status = 'submitted' where id = $1`, [id]);
  const ext = await many<any>(q, `select pm.user_id from project_members pm join memberships m on m.user_id = pm.user_id and m.org_id = pm.org_id where pm.project_id = $1 and m.role in ('client','consultant') and pm.effective_to is null`, [v.project_id]);
  await notify(q, ctx.orgId!, ext.map(e => e.user_id), `Variation ${v.number} needs your decision`, v.title, `/portal/${v.project_id}/variations/${id}`);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'variation.submit', entity: 'variations', entityId: id });
}
/** Internal recording of a decision made outside the portal (e.g. signed letter) — requires the reference in the reason. */
export async function recordVariationDecision(q: Q, ctx: Ctx, id: string, approve: boolean, reason: string) {
  const v = await one<any>(q, 'select * from variations where id = $1 for update', [id]); need(v?.status === 'submitted', 'This variation is not awaiting a decision.');
  needReason(reason, 'the decision reference or reason');
  await q.query(`update variations set status = $2, decided_by = $3, decided_at = now(), decision_reason = $4 where id = $1`, [id, approve ? 'approved' : 'rejected', ctx.userId, reason]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `variation.${approve ? 'approve' : 'reject'}`, entity: 'variations', entityId: id, detail: { reason } });
}
/** Apply an approved variation to the BOQ and contract: original rates are preserved; new items carry their approved rate. */
export async function applyVariation(q: Q, ctx: Ctx, id: string) {
  const v = await one<any>(q, 'select * from variations where id = $1 for update', [id]);
  need(v?.status === 'approved', 'Only an approved variation can be applied.'); need(!v.applied, 'This variation was already applied.');
  for (const i of await many<any>(q, 'select * from variation_items where variation_id = $1', [id])) {
    if (i.base_boq_item_id) await q.query('update boq_items set qty = qty + $2 where id = $1', [i.base_boq_item_id, i.qty]);
    else await q.query(`insert into boq_items(org_id, project_id, code, description, unit, qty, rate_paise, budget_rate_paise, source, variation_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,0,'variation',$8,$9)`, [ctx.orgId, v.project_id, `${v.number}-${i.code}`, i.description, i.unit, i.qty, i.rate_paise, id, ctx.userId]);
  }
  await q.query(`update contracts set value_paise = value_paise + $2 where project_id = $1 and status = 'active'`, [v.project_id, v.cost_delta_paise]);
  if (v.time_delta_days) await q.query(`update projects set end_date = end_date + $2::int where id = $1 and end_date is not null`, [v.project_id, v.time_delta_days]);
  await q.query('update variations set applied = true where id = $1', [id]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'variation.apply', entity: 'variations', entityId: id, detail: { cost: v.cost_delta_paise, days: v.time_delta_days } });
}

/** Submitted / certified / invoiced / collected, deliberately separate. */
export async function financialPosition(q: Q, projectId: string) {
  const r = await one<any>(q, `select
     coalesce((select sum(submitted_paise) from ra_bills where project_id = $1 and status <> 'rejected'),0) submitted,
     coalesce((select max(certified_gross_paise) from ra_bills where project_id = $1 and status in ('certified','invoiced')),0) certified,
     coalesce((select sum(amount_paise) from invoices where project_id = $1),0) invoiced,
     coalesce((select sum(collected_paise) from invoices where project_id = $1),0) collected,
     coalesce((select sum(amount_paise) from disputes where project_id = $1 and status = 'open'),0) disputed`, [projectId]);
  return Object.fromEntries(Object.entries(r!).map(([k, v]) => [k, BigInt(v as string)])) as Record<'submitted' | 'certified' | 'invoiced' | 'collected' | 'disputed', bigint>;
}
export async function projectFinalAccount(q: Q, projectId: string) {
  const c = await one<any>(q, `select * from contracts where project_id = $1 and status in ('active','closed') limit 1`, [projectId]);
  if (!c) return null;
  const pos = await financialPosition(q, projectId);
  const bal = await ledgerBalance(q, c.id);
  const vars = await one<any>(q, `select coalesce(sum(cost_delta_paise) filter (where status='approved'),0) a, coalesce(sum(cost_delta_paise) filter (where status='submitted'),0) p from variations where project_id = $1`, [projectId]);
  const base = await one<any>(q, `select coalesce(sum(round(qty * rate_paise)) filter (where source <> 'variation'),0) s from boq_items where project_id = $1`, [projectId]);
  return finalAccount({ contractValue: BigInt(base!.s), approvedVariations: BigInt(vars!.a), certifiedGross: pos.certified, advancePaid: bal.advancePaid, advanceRecovered: bal.advanceRecovered,
    retentionHeld: bal.retentionHeld, invoiced: pos.invoiced, collected: pos.collected, openDisputes: pos.disputed, pendingVariations: BigInt(vars!.p) });
}
