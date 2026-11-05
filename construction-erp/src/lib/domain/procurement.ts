import { type Ctx, type Q, AppError, many, one, audit, notify, need, needReason, nextNumber, milli, toNumeric, approvalAuthority, projectMembers } from './common';
import { checkIssue, checkReceipt, budgetPosition } from '../rules/stock';
import { lineAmount, sum } from '../rules/money';

// ---- Material request -> approval --------------------------------------------------------------
export async function submitMR(q: Q, ctx: Ctx, mrId: string) {
  const mr = await one<any>(q, 'select * from material_requests where id = $1 for update', [mrId]);
  need(mr, 'Request not found.'); need(mr.status === 'draft' || mr.status === 'rejected', 'Only a draft or rejected request can be submitted.');
  const n = await one<any>(q, 'select count(*) n from mr_lines where mr_id = $1', [mrId]);
  need(Number(n.n) > 0, 'Add at least one line before submitting.');
  await q.query(`update material_requests set status = 'submitted', reject_reason = null where id = $1`, [mrId]);
  const approvers = await projectMembers(q, mr.project_id, ['owner', 'manager', 'store']);
  await notify(q, ctx.orgId!, approvers.map(a => a.user_id), `Material request ${mr.number} awaits approval`, '', `/p/${mr.project_id}/material_requests/${mrId}`);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'mr.submit', entity: 'material_requests', entityId: mrId });
}
export async function decideMR(q: Q, ctx: Ctx, mrId: string, approve: boolean, reason?: string) {
  const mr = await one<any>(q, 'select * from material_requests where id = $1 for update', [mrId]);
  need(mr?.status === 'submitted', 'This request is not awaiting approval.');
  need(mr.created_by !== ctx.userId || ['owner', 'manager'].includes(ctx.role), 'You cannot approve your own request.', 'segregation');
  if (!approve) needReason(reason, 'a reason for rejecting');
  await q.query(`update material_requests set status = $2, reject_reason = $3, approved_by = $4 where id = $1`, [mrId, approve ? 'approved' : 'rejected', approve ? null : reason, ctx.userId]);
  if (mr.created_by) await notify(q, ctx.orgId!, [mr.created_by], `Material request ${mr.number} ${approve ? 'approved' : 'rejected'}`, reason ?? '', `/p/${mr.project_id}/material_requests/${mrId}`);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: approve ? 'mr.approve' : 'mr.reject', entity: 'material_requests', entityId: mrId, detail: { reason } });
}

// ---- RFQ -> comparison -> PO -----------------------------------------------------------------------
export async function createRfq(q: Q, ctx: Ctx, mrId: string) {
  const mr = await one<any>(q, 'select * from material_requests where id = $1', [mrId]);
  need(mr?.status === 'approved', 'Only an approved material request can go to RFQ.');
  const number = await nextNumber(q, ctx, mr.project_id, 'rfq', 'RFQ');
  return (await one<any>(q, `insert into rfqs(org_id, project_id, mr_id, number, created_by) values ($1,$2,$3,$4,$5) returning *`, [ctx.orgId, mr.project_id, mrId, number, ctx.userId]))!;
}
export async function addQuote(q: Q, ctx: Ctx, rfqId: string, supplierId: string, ratesByLine: Record<string, bigint>, leadDays: number | null) {
  const rfq = await one<any>(q, 'select * from rfqs where id = $1', [rfqId]); need(rfq?.status === 'open', 'This RFQ is closed.');
  const lines = await many<any>(q, 'select * from mr_lines where mr_id = $1', [rfq.mr_id]);
  for (const l of lines) need(ratesByLine[l.id] !== undefined && ratesByLine[l.id] >= 0n, `Enter a rate for ${l.item_code}.`);
  const total = sum(lines.map(l => lineAmount(milli(l.qty), ratesByLine[l.id])));
  const rates = Object.fromEntries(Object.entries(ratesByLine).map(([k, v]) => [k, v.toString()]));
  await q.query(`insert into rfq_quotes(org_id, project_id, rfq_id, supplier_id, rates, total_paise, lead_days, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.orgId, rfq.project_id, rfqId, supplierId, JSON.stringify(rates), total.toString(), leadDays, ctx.userId]);
}
export async function comparison(q: Q, rfqId: string) {
  const quotes = await many<any>(q, `select qt.*, p.name supplier from rfq_quotes qt join parties p on p.id = qt.supplier_id where rfq_id = $1 order by total_paise::bigint`, [rfqId]);
  return quotes;
}
export async function poFromQuote(q: Q, ctx: Ctx, quoteId: string, deliveryDate: string | null) {
  const qt = await one<any>(q, 'select * from rfq_quotes where id = $1 for update', [quoteId]); need(qt, 'Quote not found.');
  const rfq = await one<any>(q, 'select * from rfqs where id = $1 for update', [qt.rfq_id]); need(rfq.status === 'open', 'This RFQ was already awarded.');
  const mr = await one<any>(q, 'select * from material_requests where id = $1', [rfq.mr_id]);
  const lines = await many<any>(q, 'select * from mr_lines where mr_id = $1', [mr.id]);
  const number = await nextNumber(q, ctx, mr.project_id, 'po', 'PO');
  const po = (await one<any>(q, `insert into purchase_orders(org_id, project_id, number, supplier_id, mr_id, total_paise, delivery_date, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [ctx.orgId, mr.project_id, number, qt.supplier_id, mr.id, qt.total_paise, deliveryDate, ctx.userId]))!;
  for (const l of lines) {
    await q.query(`insert into po_lines(org_id, project_id, po_id, mr_line_id, boq_item_id, item_code, description, unit, qty, rate_paise, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ctx.orgId, mr.project_id, po.id, l.id, l.boq_item_id, l.item_code, l.description, l.unit, l.qty, qt.rates[l.id], ctx.userId]);
  }
  await q.query('update rfq_quotes set selected = (id = $2) where rfq_id = $1', [rfq.id, quoteId]);
  await q.query(`update rfqs set status = 'closed' where id = $1`, [rfq.id]);
  await q.query(`update material_requests set status = 'ordered' where id = $1`, [mr.id]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'po.create', entity: 'purchase_orders', entityId: po.id });
  return po;
}

/** Committed purchasing against the cost budget, per BOQ item. */
export async function budgetReconciliation(q: Q, projectId: string, excludePoId?: string) {
  const rows = await many<any>(q, `
    select b.id, b.code, b.description, b.qty, b.budget_rate_paise,
      coalesce((select sum(round(pl.qty * pl.rate_paise)) from po_lines pl join purchase_orders po on po.id = pl.po_id
                where pl.boq_item_id = b.id and po.status in ('approved','issued','part_received','received','closed') and ($2::uuid is null or po.id <> $2)), 0) committed,
      coalesce((select sum(round((pl.received_qty - pl.rejected_qty) * pl.rate_paise)) from po_lines pl join purchase_orders po on po.id = pl.po_id
                where pl.boq_item_id = b.id and po.status in ('part_received','received','closed')), 0) received
    from boq_items b where b.project_id = $1 order by b.code`, [projectId, excludePoId ?? null]);
  return rows.map(r => ({ ...r, budget: lineAmount(milli(r.qty), BigInt(r.budget_rate_paise)), pos: budgetPosition(lineAmount(milli(r.qty), BigInt(r.budget_rate_paise)), BigInt(r.committed), BigInt(r.received)) }));
}

export async function approvePO(q: Q, ctx: Ctx, poId: string, overrideReason?: string) {
  const po = await one<any>(q, 'select * from purchase_orders where id = $1 for update', [poId]);
  need(po?.status === 'draft', 'Only a draft purchase order can be approved.');
  await approvalAuthority(q, ctx, po.project_id, 'po:approve', BigInt(po.total_paise));
  need(po.created_by !== ctx.userId || ['owner', 'manager'].includes(ctx.role), 'The person who raised a purchase order cannot approve it.', 'segregation');
  const lines = await many<any>(q, 'select * from po_lines where po_id = $1', [poId]);
  const rec = await budgetReconciliation(q, po.project_id, poId);
  const over: string[] = [];
  for (const l of lines.filter(l => l.boq_item_id)) {
    const r = rec.find(x => x.id === l.boq_item_id)!;
    if (r.pos.committed + lineAmount(milli(l.qty), BigInt(l.rate_paise)) > r.pos.budget) over.push(r.code);
  }
  if (over.length) {
    need(['owner', 'manager'].includes(ctx.role), `This order takes ${[...new Set(over)].join(', ')} over its cost budget. A manager must approve it with a reason.`, 'over_budget');
    needReason(overrideReason, 'a reason for exceeding budget');
  }
  await q.query(`update purchase_orders set status = 'approved', approved_by = $2, override_reason = $3 where id = $1`, [poId, ctx.userId, over.length ? overrideReason : null]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'po.approve', entity: 'purchase_orders', entityId: poId, detail: { over_budget: over, reason: overrideReason } });
}
export async function issuePO(q: Q, ctx: Ctx, poId: string) {
  const po = await one<any>(q, 'select * from purchase_orders where id = $1 for update', [poId]);
  need(po?.status === 'approved', 'Approve the purchase order before issuing it.');
  await q.query(`update purchase_orders set status = 'issued' where id = $1`, [poId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'po.issue', entity: 'purchase_orders', entityId: poId });
}

// ---- Stock -------------------------------------------------------------------------------------------
const lockKey = (q: Q, project: string, site: string, item: string) => q.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`stock:${project}:${site}:${item}`]);
export async function stockOnHand(q: Q, projectId: string, siteId: string, itemCode: string, bucket: 'store' | 'quarantine' = 'store') {
  const r = await one<any>(q, `select coalesce(sum(qty),0) s from stock_movements where project_id = $1 and site_id = $2 and item_code = $3 and bucket = $4`, [projectId, siteId, itemCode, bucket]);
  return milli(r!.s);
}
async function move(q: Q, ctx: Ctx, m: { projectId: string; siteId: string; item: string; desc?: string; unit: string; qty: bigint; bucket?: string; kind: string; refType?: string; refId?: string; activityId?: string | null; boqId?: string | null; note?: string }) {
  await q.query(`insert into stock_movements(org_id, project_id, site_id, item_code, description, unit, qty, bucket, kind, ref_type, ref_id, activity_id, boq_item_id, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [ctx.orgId, m.projectId, m.siteId, m.item, m.desc ?? null, m.unit, toNumeric(m.qty), m.bucket ?? 'store', m.kind, m.refType ?? null, m.refId ?? null, m.activityId ?? null, m.boqId ?? null, m.note ?? null, ctx.userId]);
}

export interface GrnLineIn { poLineId: string; received: bigint; accepted: bigint; rejected: bigint; reason?: string; expectation?: 'replacement' | 'credit' | 'none' }
export async function receiveGoods(q: Q, ctx: Ctx, p: { poId: string; siteId: string; receivedOn: string; notes?: string; lines: GrnLineIn[] }) {
  const po = await one<any>(q, 'select * from purchase_orders where id = $1 for update', [p.poId]);
  need(po && ['issued', 'part_received'].includes(po.status), 'Goods can only be received against an issued purchase order.');
  need(p.lines.some(l => l.received > 0n), 'Enter a received quantity on at least one line.');
  const number = await nextNumber(q, ctx, po.project_id, 'grn', 'GRN');
  const grn = (await one<any>(q, `insert into goods_receipts(org_id, project_id, po_id, number, site_id, received_on, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [ctx.orgId, po.project_id, p.poId, number, p.siteId, p.receivedOn, p.notes ?? null, ctx.userId]))!;
  for (const l of p.lines.filter(l => l.received > 0n)) {
    const pl = await one<any>(q, 'select * from po_lines where id = $1 and po_id = $2 for update', [l.poLineId, p.poId]);
    need(pl, 'A line does not belong to this purchase order.');
    checkReceipt({ orderedMilli: milli(pl.qty), receivedSoFarMilli: milli(pl.received_qty), receivedMilli: l.received, acceptedMilli: l.accepted, rejectedMilli: l.rejected });
    if (l.rejected > 0n) { needReason(l.reason, `a rejection reason for ${pl.item_code}`); need(l.expectation && l.expectation !== 'none', `Say whether ${pl.item_code} will be replaced or credited by the supplier.`); }
    await q.query(`insert into grn_lines(org_id, project_id, grn_id, po_line_id, received_qty, accepted_qty, rejected_qty, reject_reason, expectation, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ctx.orgId, po.project_id, grn.id, l.poLineId, toNumeric(l.received), toNumeric(l.accepted), toNumeric(l.rejected), l.reason ?? null, l.expectation ?? 'none', ctx.userId]);
    await q.query(`update po_lines set received_qty = received_qty + $2, rejected_qty = rejected_qty + $3 where id = $1`, [l.poLineId, toNumeric(l.received), toNumeric(l.rejected)]);
    if (l.accepted > 0n) { await lockKey(q, po.project_id, p.siteId, pl.item_code); await move(q, ctx, { projectId: po.project_id, siteId: p.siteId, item: pl.item_code, desc: pl.description, unit: pl.unit, qty: l.accepted, kind: 'receipt', refType: 'grn', refId: grn.id, boqId: pl.boq_item_id }); }
    if (l.rejected > 0n) await move(q, ctx, { projectId: po.project_id, siteId: p.siteId, item: pl.item_code, desc: pl.description, unit: pl.unit, qty: l.rejected, bucket: 'quarantine', kind: 'reject_receipt', refType: 'grn', refId: grn.id, note: `${l.expectation}: ${l.reason}` });
  }
  const left = await one<any>(q, 'select count(*) n from po_lines where po_id = $1 and (received_qty - rejected_qty) < qty', [p.poId]);
  await q.query('update purchase_orders set status = $2 where id = $1', [p.poId, Number(left!.n) === 0 ? 'received' : 'part_received']);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'grn.create', entity: 'goods_receipts', entityId: grn.id });
  return grn;
}

export async function issueStock(q: Q, ctx: Ctx, p: { projectId: string; siteId: string; itemCode: string; qty: bigint; activityId?: string | null; note?: string }) {
  await lockKey(q, p.projectId, p.siteId, p.itemCode);
  const have = await stockOnHand(q, p.projectId, p.siteId, p.itemCode);
  checkIssue(have, p.qty);
  const last = await one<any>(q, `select unit, description, boq_item_id from stock_movements where project_id = $1 and site_id = $2 and item_code = $3 order by created_at desc limit 1`, [p.projectId, p.siteId, p.itemCode]);
  await move(q, ctx, { projectId: p.projectId, siteId: p.siteId, item: p.itemCode, desc: last.description, unit: last.unit, qty: -p.qty, kind: 'issue', activityId: p.activityId, boqId: last.boq_item_id, note: p.note });
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'stock.issue', entity: 'stock_movements', detail: { item: p.itemCode, qty: p.qty.toString() } });
}
/** Reject material goes back to the supplier (replacement or credit expected) — leaves quarantine. */
export async function returnToSupplier(q: Q, ctx: Ctx, p: { projectId: string; siteId: string; itemCode: string; qty: bigint; note: string }) {
  await lockKey(q, p.projectId, p.siteId, p.itemCode);
  const have = await stockOnHand(q, p.projectId, p.siteId, p.itemCode, 'quarantine');
  need(p.qty > 0n && p.qty <= have, `Only ${have} is in quarantine.`);
  needReason(p.note, 'a note (e.g. debit note number)');
  const last = await one<any>(q, `select unit, description from stock_movements where project_id = $1 and site_id = $2 and item_code = $3 and bucket = 'quarantine' limit 1`, [p.projectId, p.siteId, p.itemCode]);
  await move(q, ctx, { projectId: p.projectId, siteId: p.siteId, item: p.itemCode, desc: last.description, unit: last.unit, qty: -p.qty, bucket: 'quarantine', kind: 'supplier_return', note: p.note });
}
/** Unused issued material returned to store. */
export async function returnToStore(q: Q, ctx: Ctx, p: { projectId: string; siteId: string; itemCode: string; qty: bigint; note?: string }) {
  const issued = await one<any>(q, `select coalesce(-sum(qty) filter (where kind='issue'),0) i, coalesce(sum(qty) filter (where kind='return'),0) r from stock_movements where project_id = $1 and site_id = $2 and item_code = $3`, [p.projectId, p.siteId, p.itemCode]);
  need(p.qty > 0n && p.qty <= milli(issued!.i) - milli(issued!.r), 'You cannot return more than has been issued from this store.');
  const last = await one<any>(q, `select unit, description from stock_movements where project_id = $1 and site_id = $2 and item_code = $3 limit 1`, [p.projectId, p.siteId, p.itemCode]);
  await move(q, ctx, { projectId: p.projectId, siteId: p.siteId, item: p.itemCode, desc: last.description, unit: last.unit, qty: p.qty, kind: 'return', note: p.note });
}

export async function dispatchTransfer(q: Q, ctx: Ctx, p: { projectId: string; fromSiteId: string; toSiteId: string; lines: { itemCode: string; qty: bigint }[] }) {
  need(p.fromSiteId !== p.toSiteId, 'Choose two different sites.'); need(p.lines.length > 0, 'Add at least one item.');
  const number = await nextNumber(q, ctx, p.projectId, 'tr', 'TR');
  const tr = (await one<any>(q, `insert into site_transfers(org_id, project_id, number, from_site_id, to_site_id, created_by) values ($1,$2,$3,$4,$5,$6) returning *`, [ctx.orgId, p.projectId, number, p.fromSiteId, p.toSiteId, ctx.userId]))!;
  for (const l of p.lines) {
    await lockKey(q, p.projectId, p.fromSiteId, l.itemCode);
    checkIssue(await stockOnHand(q, p.projectId, p.fromSiteId, l.itemCode), l.qty);
    const last = (await one<any>(q, `select unit, description, boq_item_id from stock_movements where project_id = $1 and site_id = $2 and item_code = $3 limit 1`, [p.projectId, p.fromSiteId, l.itemCode]))!;
    await q.query(`insert into transfer_lines(org_id, project_id, transfer_id, item_code, description, unit, qty, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [ctx.orgId, p.projectId, tr.id, l.itemCode, last.description, last.unit, toNumeric(l.qty), ctx.userId]);
    await move(q, ctx, { projectId: p.projectId, siteId: p.fromSiteId, item: l.itemCode, desc: last.description, unit: last.unit, qty: -l.qty, kind: 'transfer_out', refType: 'transfer', refId: tr.id, boqId: last.boq_item_id });
  }
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'transfer.dispatch', entity: 'site_transfers', entityId: tr.id });
  return tr;
}
export async function receiveTransfer(q: Q, ctx: Ctx, trId: string) {
  const tr = await one<any>(q, 'select * from site_transfers where id = $1 for update', [trId]);
  need(tr?.status === 'in_transit', 'This transfer is not in transit.');
  for (const l of await many<any>(q, 'select * from transfer_lines where transfer_id = $1', [trId])) {
    await lockKey(q, tr.project_id, tr.to_site_id, l.item_code);
    await move(q, ctx, { projectId: tr.project_id, siteId: tr.to_site_id, item: l.item_code, desc: l.description, unit: l.unit, qty: milli(l.qty), kind: 'transfer_in', refType: 'transfer', refId: trId });
  }
  await q.query(`update site_transfers set status = 'received', received_at = now() where id = $1`, [trId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'transfer.receive', entity: 'site_transfers', entityId: trId });
}

export async function applyStockCount(q: Q, ctx: Ctx, countId: string) {
  const c = await one<any>(q, 'select * from stock_counts where id = $1 for update', [countId]);
  need(c?.status === 'draft', 'This count was already applied.');
  const lines = await many<any>(q, 'select * from stock_count_lines where count_id = $1', [countId]);
  for (const l of lines) {
    await lockKey(q, c.project_id, c.site_id, l.item_code);
    const sys = await stockOnHand(q, c.project_id, c.site_id, l.item_code);
    const delta = milli(l.counted_qty) - sys;
    if (delta !== 0n) await move(q, ctx, { projectId: c.project_id, siteId: c.site_id, item: l.item_code, unit: l.unit, qty: delta, kind: 'count_adjust', refType: 'count', refId: countId, note: `system ${sys}, counted ${l.counted_qty}` });
  }
  await q.query(`update stock_counts set status = 'applied' where id = $1`, [countId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'stock.count_applied', entity: 'stock_counts', entityId: countId });
}
export async function stockBalances(q: Q, projectId: string) {
  return many<any>(q, `select m.site_id, w.name site, m.item_code, max(m.description) description, max(m.unit) unit, m.bucket, sum(m.qty) qty
     from stock_movements m join wbs_nodes w on w.id = m.site_id where m.project_id = $1 group by m.site_id, w.name, m.item_code, m.bucket having sum(m.qty) <> 0 order by w.name, m.item_code`, [projectId]);
}
