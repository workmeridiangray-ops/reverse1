import type { Db } from "../db";
import type { TCtx } from "../actions";
import { UserError } from "../errors";
import { audit } from "../audit";
import { sumLines, type ResolvedLine } from "./lines";
import { requestApproval, ruleFor, onDecision } from "./approvals";
import { moveStock, applyReceiptCost, autoAllocate } from "./inventory";
import { postJournal, today, addDays } from "./ledger";
import { mulDiv, perBase, lineAmounts } from "../money";
import { assertBranch, shortageLines } from "./sales";

const num = async (db: Db, t: string, k: string) => (await db.query("select next_number($1,$2) n", [t, k])).rows[0].n as string;

// -------- purchase requests --------
export async function createPR(db: Db, ctx: TCtx, i: { branchId: string; reason?: string; departmentId?: string; sourceOrderId?: string; lines: { itemId: string; qty: number; supplierId?: string; estCost?: number }[] }) {
  await assertBranch(ctx, i.branchId);
  if (!i.lines.length) throw new UserError("Add at least one line.");
  const number = await num(db, ctx.tenant.id, "purchase_request");
  const id = (await db.query(`insert into purchase_requests(tenant_id,number,branch_id,reason,department_id,source_order_id,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [ctx.tenant.id, number, i.branchId, i.reason ?? null, i.departmentId || null, i.sourceOrderId ?? null, ctx.user.id])).rows[0].id as string;
  for (const l of i.lines) {
    await db.query("insert into purchase_request_lines(tenant_id,request_id,item_id,qty,supplier_id,est_unit_cost_paise) values ($1,$2,$3,$4,$5,$6)",
      [ctx.tenant.id, id, l.itemId, l.qty, l.supplierId || null, l.estCost ?? 0]);
  }
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "pr.created", entityType: "purchase_request", entityId: id, detail: { number } });
  return { id, number };
}

/** Purchase request for the uncovered shortage of a confirmed sales order. Idempotent: never requests the same shortage twice. */
export async function requestForShortage(db: Db, ctx: TCtx, orderId: string) {
  const sh = (await shortageLines(db, ctx.tenant.id, orderId)).filter((s: any) => s.short > s.requested);
  if (!sh.length) throw new UserError("Nothing to request: every shortage on this order is already covered by a purchase request.");
  const o = (await db.query("select branch_id, number from sales_orders where id=$1", [orderId])).rows[0];
  const lines = [];
  for (const s of sh) {
    const it = (await db.query("select purchase_price_paise from items where id=$1", [s.item_id])).rows[0];
    const sup = (await db.query(`select pol.order_id, po.supplier_id from purchase_order_lines pol join purchase_orders po on po.id=pol.order_id and po.tenant_id=pol.tenant_id
      where pol.tenant_id=$1 and pol.item_id=$2 and po.status <> 'cancelled' order by po.created_at desc limit 1`, [ctx.tenant.id, s.item_id])).rows[0];
    lines.push({ itemId: s.item_id, qty: s.short - s.requested, supplierId: sup?.supplier_id, estCost: it.purchase_price_paise });
  }
  return createPR(db, ctx, { branchId: o.branch_id, reason: `Stock shortage for sales order ${o.number}`, sourceOrderId: orderId, lines });
}

export async function submitPR(db: Db, ctx: TCtx, id: string) {
  const pr = (await db.query("select * from purchase_requests where id=$1 for update", [id])).rows[0];
  if (!pr) throw new UserError("Purchase request not found");
  if (pr.status !== "draft") throw new UserError(`Only draft requests can be submitted (this one is ${pr.status.replace("_", " ")}).`);
  const amt = Number((await db.query("select coalesce(sum(qty * est_unit_cost_paise / 1000),0) s from purchase_request_lines where request_id=$1", [id])).rows[0].s);
  const rule = await ruleFor(db, ctx.tenant.id, "purchase_request", amt);
  if (rule) {
    await db.query("update purchase_requests set status='pending_approval' where id=$1", [id]);
    await requestApproval(db, ctx, { entityType: "purchase_request", entityId: id, ref: pr.number, amount: amt, permission: rule.approver_permission, impact: { estimated_cost: amt } });
    return "pending_approval";
  }
  await db.query("update purchase_requests set status='approved' where id=$1", [id]);
  return "approved";
}
onDecision("purchase_request", async (db, _c, id, ok) => {
  await db.query("update purchase_requests set status=$2 where id=$1 and status='pending_approval'", [id, ok ? "approved" : "rejected"]);
});

/** Approved request → one purchase order per supplier. */
export async function convertPR(db: Db, ctx: TCtx, id: string, warehouseId: string, defaultSupplierId?: string) {
  const pr = (await db.query("select * from purchase_requests where id=$1 for update", [id])).rows[0];
  if (!pr) throw new UserError("Purchase request not found");
  if (pr.status !== "approved") throw new UserError("Only approved requests can be converted to purchase orders.");
  const ls = (await db.query(
    `select prl.*, i.purchase_price_paise, i.name, coalesce(t.rate_bps,0) rate_bps from purchase_request_lines prl join items i on i.id=prl.item_id and i.tenant_id=prl.tenant_id
       left join tax_codes t on t.id=i.tax_code_id and t.tenant_id=i.tenant_id where prl.request_id=$1`, [id])).rows;
  const bySup = new Map<string, any[]>();
  for (const l of ls) {
    const s = l.supplier_id ?? defaultSupplierId;
    if (!s) throw new UserError(`Choose a supplier for ${l.name}.`);
    bySup.set(s, [...(bySup.get(s) ?? []), l]);
  }
  const out: { id: string; number: string }[] = [];
  for (const [supplierId, group] of bySup) {
    const rl: ResolvedLine[] = group.map((l) => {
      const cost = l.est_unit_cost_paise || l.purchase_price_paise;
      const a = lineAmounts(l.qty, cost, 0, l.rate_bps);
      return { itemId: l.item_id, itemName: l.name, kind: "goods", qtyBase: l.qty, uomQty: l.qty, uom: "", factorMilli: 1000, pricePerUom: cost, discountBps: 0, taxBps: l.rate_bps, ...a };
    });
    for (const r of rl) r.uom = (await db.query("select base_unit from items where id=$1", [r.itemId])).rows[0].base_unit;
    out.push(await createPO(db, ctx, { supplierId, branchId: pr.branch_id, warehouseId, requestId: id, lines: rl }));
  }
  await db.query("update purchase_requests set status='converted' where id=$1", [id]);
  return out;
}

// -------- purchase orders --------
export async function createPO(db: Db, ctx: TCtx, i: { supplierId: string; branchId: string; warehouseId: string; requestId?: string; expectedDate?: string; notes?: string; lines: ResolvedLine[] }) {
  await assertBranch(ctx, i.branchId);
  const sup = (await db.query("select status, name, doc_expiry_on from suppliers where id=$1 and tenant_id=$2", [i.supplierId, ctx.tenant.id])).rows[0];
  if (!sup) throw new UserError("Supplier not found");
  if (sup.status !== "active") throw new UserError(`${sup.name} is retired and cannot receive new orders.`);
  if (sup.doc_expiry_on && sup.doc_expiry_on < today()) throw new UserError(`${sup.name}'s compliance documents expired on ${sup.doc_expiry_on}. Update the supplier record before ordering.`);
  const t = sumLines(i.lines);
  const number = await num(db, ctx.tenant.id, "purchase_order");
  const id = (await db.query(
    `insert into purchase_orders(tenant_id,number,request_id,supplier_id,branch_id,warehouse_id,expected_date,notes,subtotal_paise,tax_paise,total_paise,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [ctx.tenant.id, number, i.requestId ?? null, i.supplierId, i.branchId, i.warehouseId, i.expectedDate || null, i.notes ?? null, t.subtotal, t.tax, t.total, ctx.user.id])).rows[0].id as string;
  let n = 1;
  for (const l of i.lines) {
    await db.query(
      `insert into purchase_order_lines(tenant_id,order_id,line_no,item_id,qty,uom,uom_factor_milli,unit_cost_paise,tax_bps,net_paise,tax_paise,total_paise)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [ctx.tenant.id, id, n++, l.itemId, l.qtyBase, l.uom, l.factorMilli, l.pricePerUom, l.taxBps, l.net, l.tax, l.total]);
  }
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "po.created", entityType: "purchase_order", entityId: id, detail: { number, total: t.total } });
  return { id, number };
}

export async function submitPO(db: Db, ctx: TCtx, id: string) {
  const po = (await db.query("select * from purchase_orders where id=$1 for update", [id])).rows[0];
  if (!po) throw new UserError("Purchase order not found");
  if (po.status !== "draft") throw new UserError(`Only draft purchase orders can be submitted (this one is ${po.status.replace("_", " ")}).`);
  const rule = await ruleFor(db, ctx.tenant.id, "purchase_order", po.total_paise);
  if (rule) {
    await db.query("update purchase_orders set status='pending_approval' where id=$1", [id]);
    await requestApproval(db, ctx, { entityType: "purchase_order", entityId: id, ref: po.number, amount: po.total_paise, permission: rule.approver_permission, impact: { commitment: po.total_paise } });
    return "pending_approval";
  }
  await db.query("update purchase_orders set status='approved' where id=$1", [id]);
  return "approved";
}
onDecision("purchase_order", async (db, _c, id, ok) => {
  await db.query("update purchase_orders set status=$2 where id=$1 and status='pending_approval'", [id, ok ? "approved" : "draft"]);
});
export async function markSent(db: Db, id: string) {
  const r = await db.query("update purchase_orders set status='sent' where id=$1 and status='approved'", [id]);
  if (!r.rowCount) throw new UserError("Only approved purchase orders can be sent to the supplier.");
}
export async function acknowledgePO(db: Db, id: string, ref: string, expected?: string) {
  const r = await db.query("update purchase_orders set status='acknowledged', supplier_ack_ref=$2, expected_date=coalesce($3, expected_date) where id=$1 and status in ('sent','approved')", [id, ref, expected || null]);
  if (!r.rowCount) throw new UserError("Only sent purchase orders can be acknowledged.");
}
export async function cancelPO(db: Db, ctx: TCtx, id: string, reason: string) {
  if (reason.trim().length < 3) throw new UserError("Give a reason.", { reason: "Required" });
  const po = (await db.query("select * from purchase_orders where id=$1 for update", [id])).rows[0];
  if (!po) throw new UserError("Not found");
  const rec = Number((await db.query("select coalesce(sum(received_qty),0) s from purchase_order_lines where order_id=$1", [id])).rows[0].s);
  if (rec > 0) throw new UserError("Goods were already received against this order; it cannot be cancelled. Close the remainder by receiving or returning.");
  if (["cancelled", "closed"].includes(po.status)) throw new UserError(`Already ${po.status}.`);
  await db.query("update purchase_orders set status='cancelled' where id=$1", [id]);
  await db.query("update approval_requests set status='cancelled' where entity_type='purchase_order' and entity_id=$1 and status='pending'", [id]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "po.cancelled", entityType: "purchase_order", entityId: id, reason });
}

// -------- goods receipt --------
export async function receiveGoods(db: Db, ctx: TCtx, orderId: string, items: { poLineId: string; qty: number }[], deliveryRef?: string, warehouseId?: string) {
  const po = (await db.query("select * from purchase_orders where id=$1 for update", [orderId])).rows[0];
  if (!po) throw new UserError("Purchase order not found");
  if (!["approved", "sent", "acknowledged", "partially_received"].includes(po.status)) throw new UserError(`Goods cannot be received against a ${po.status.replace("_", " ")} purchase order.`);
  const rl = items.filter((x) => x.qty > 0);
  if (!rl.length) throw new UserError("Enter a received quantity for at least one line.");
  const wh = warehouseId || po.warehouse_id;
  const number = await num(db, ctx.tenant.id, "goods_receipt");
  const grn = (await db.query("insert into goods_receipts(tenant_id,number,order_id,warehouse_id,supplier_delivery_ref,created_by) values ($1,$2,$3,$4,$5,$6) returning id",
    [ctx.tenant.id, number, orderId, wh, deliveryRef ?? null, ctx.user.id])).rows[0].id as string;
  let value = 0;
  for (const r of rl) {
    const l = (await db.query("select * from purchase_order_lines where id=$1 and order_id=$2 for update", [r.poLineId, orderId])).rows[0];
    if (!l) throw new UserError("Line does not belong to this purchase order");
    const open = l.qty - l.received_qty;
    if (r.qty > open) throw new UserError(`Line ${l.line_no}: only ${open / 1000} still outstanding; you entered ${r.qty / 1000}.`);
    const unitBase = perBase(l.unit_cost_paise, Number(l.uom_factor_milli));
    const lineId = (await db.query("insert into goods_receipt_lines(tenant_id,receipt_id,po_line_id,item_id,qty,unit_cost_paise) values ($1,$2,$3,$4,$5,$6) returning id",
      [ctx.tenant.id, grn, l.id, l.item_id, r.qty, unitBase])).rows[0].id;
    await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: l.item_id, warehouseId: wh, delta: r.qty, kind: "receipt", unitCost: unitBase, docType: "goods_receipt", docId: grn, docLineId: lineId });
    await applyReceiptCost(db, ctx.tenant.id, l.item_id, r.qty, unitBase);
    await db.query("update purchase_order_lines set received_qty = received_qty + $2 where id=$1", [l.id, r.qty]);
    value += mulDiv(r.qty, l.unit_cost_paise, Number(l.uom_factor_milli));
    await autoAllocate(db, ctx.tenant.id, l.item_id, wh);
  }
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Goods receipt ${number}`, sourceType: "goods_receipt", sourceId: grn,
    lines: [{ account: "inventory", debit: value }, { account: "grni", credit: value }] });
  await db.query("update goods_receipts set journal_id=$2 where id=$1", [grn, j]);
  const left = (await db.query("select sum(qty - received_qty) s from purchase_order_lines where order_id=$1", [orderId])).rows[0].s;
  await db.query("update purchase_orders set status=$2 where id=$1", [orderId, Number(left) === 0 ? "received" : "partially_received"]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "grn.posted", entityType: "goods_receipt", entityId: grn, detail: { number, value } });
  return { id: grn, number, value };
}

export async function returnToSupplier(db: Db, ctx: TCtx, poLineId: string, qty: number, reason: string) {
  if (reason.trim().length < 3) throw new UserError("Give a reason for the return.", { reason: "Required" });
  const l = (await db.query("select l.*, o.warehouse_id, o.id oid from purchase_order_lines l join purchase_orders o on o.id=l.order_id and o.tenant_id=l.tenant_id where l.id=$1 for update of l", [poLineId])).rows[0];
  if (!l) throw new UserError("Line not found");
  if (qty <= 0 || qty > l.received_qty - l.returned_qty) throw new UserError("Return quantity exceeds what was received.");
  if (l.billed_qty > l.received_qty - l.returned_qty - qty) throw new UserError("Part of this quantity has already been billed; raise a debit adjustment with the supplier instead.");
  const number = await num(db, ctx.tenant.id, "supplier_return");
  const unitBase = perBase(l.unit_cost_paise, Number(l.uom_factor_milli));
  const id = (await db.query(`insert into supplier_returns(tenant_id,number,order_id,po_line_id,warehouse_id,item_id,qty,unit_cost_paise,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [ctx.tenant.id, number, l.oid, poLineId, l.warehouse_id, l.item_id, qty, unitBase, reason, ctx.user.id])).rows[0].id;
  await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: l.item_id, warehouseId: l.warehouse_id, delta: -qty, kind: "supplier_return", unitCost: unitBase, docType: "supplier_return", docId: id, docLineId: id });
  await db.query("update purchase_order_lines set returned_qty = returned_qty + $2 where id=$1", [poLineId, qty]);
  const v = mulDiv(qty, l.unit_cost_paise, Number(l.uom_factor_milli));
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Return to supplier ${number}`, sourceType: "supplier_return", sourceId: id,
    lines: [{ account: "grni", debit: v }, { account: "inventory", credit: v }] });
  await db.query("update supplier_returns set journal_id=$2 where id=$1", [id, j]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "supplier_return.posted", entityType: "supplier_return", entityId: id, reason, detail: { qty } });
  return { id, number };
}

// -------- supplier bills with three-way match --------
export interface MatchTolerance { qtyBps: number; priceBps: number }
export const DEFAULT_TOLERANCE: MatchTolerance = { qtyBps: 0, priceBps: 200 };

export async function recordBill(db: Db, ctx: TCtx, i: { orderId: string; supplierRef: string; billDate: string; dueDate?: string; lines: { poLineId: string; qty: number; unitCostPaise: number }[]; tolerance?: MatchTolerance }) {
  const tol = i.tolerance ?? DEFAULT_TOLERANCE;
  const po = (await db.query("select * from purchase_orders where id=$1 for update", [i.orderId])).rows[0];
  if (!po) throw new UserError("Purchase order not found");
  const sup = (await db.query("select * from suppliers where id=$1", [po.supplier_id])).rows[0];
  const dup = (await db.query("select number from supplier_bills where tenant_id=$1 and supplier_id=$2 and supplier_ref=$3 and status <> 'void'", [ctx.tenant.id, po.supplier_id, i.supplierRef])).rows[0];
  if (dup) throw new UserError(`This supplier invoice number was already recorded as ${dup.number}.`, { supplierRef: "Duplicate supplier invoice" });
  const detail: any[] = []; let exception = false;
  const resolved: any[] = [];
  for (const b of i.lines.filter((x) => x.qty > 0)) {
    const l = (await db.query("select l.*, i.name from purchase_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.id=$1 and l.order_id=$2 for update of l", [b.poLineId, i.orderId])).rows[0];
    if (!l) throw new UserError("Line does not belong to this purchase order");
    const billable = l.received_qty - l.returned_qty - l.billed_qty;
    const qtyOver = b.qty - billable;
    const qtyTolQty = Math.floor((billable * tol.qtyBps) / 10000);
    const priceDiffBps = l.unit_cost_paise === 0 ? 0 : Math.round((Math.abs(b.unitCostPaise - l.unit_cost_paise) * 10000) / l.unit_cost_paise);
    const issues: string[] = [];
    if (qtyOver > qtyTolQty) issues.push(`billed ${b.qty / 1000} but only ${Math.max(0, billable) / 1000} received and unbilled`);
    if (priceDiffBps > tol.priceBps) issues.push(`unit cost ${b.unitCostPaise / 100} differs from PO ${l.unit_cost_paise / 100} by ${(priceDiffBps / 100).toFixed(2)}% (tolerance ${(tol.priceBps / 100).toFixed(2)}%)`);
    if (issues.length) exception = true;
    detail.push({ line: l.line_no, item: l.name, agreedQty: l.qty, receivedQty: l.received_qty, billedQty: b.qty, poCost: l.unit_cost_paise, billCost: b.unitCostPaise, issues });
    resolved.push({ l, b });
  }
  if (!resolved.length) throw new UserError("Enter a quantity for at least one line.");
  let net = 0, tax = 0;
  const calc = resolved.map(({ l, b }) => {
    const a = lineAmounts(b.qty, b.unitCostPaise, 0, l.tax_bps, Number(l.uom_factor_milli));
    net += a.net; tax += a.tax; return { l, b, a };
  });
  const number = await num(db, ctx.tenant.id, "supplier_bill");
  const due = i.dueDate || addDays(i.billDate, sup.payment_terms_days);
  const id = (await db.query(
    `insert into supplier_bills(tenant_id,number,supplier_id,order_id,supplier_ref,bill_date,due_date,status,match_status,match_detail,subtotal_paise,tax_paise,total_paise,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [ctx.tenant.id, number, po.supplier_id, i.orderId, i.supplierRef, i.billDate, due, exception ? "exception" : "draft", exception ? "exception" : "matched", JSON.stringify(detail), net, tax, net + tax, ctx.user.id])).rows[0].id as string;
  for (const { l, b, a } of calc) {
    await db.query("insert into supplier_bill_lines(tenant_id,bill_id,po_line_id,item_id,qty,unit_cost_paise,net_paise,tax_bps,tax_paise) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [ctx.tenant.id, id, l.id, l.item_id, b.qty, b.unitCostPaise, a.net, l.tax_bps, a.tax]);
  }
  if (!exception) await postBill(db, ctx, id);
  else {
    await db.query("insert into approval_requests(tenant_id,entity_type,entity_id,entity_ref,amount_paise,approver_permission,impact,requested_by) values ($1,'supplier_bill',$2,$3,$4,'finance.approve',$5,$6)",
      [ctx.tenant.id, id, number, net + tax, JSON.stringify({ match: detail }), ctx.user.id]);
  }
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: exception ? "bill.exception" : "bill.matched", entityType: "supplier_bill", entityId: id, detail: { number } });
  return { id, number, exception };
}

export async function postBill(db: Db, ctx: TCtx, billId: string) {
  const b = (await db.query("select * from supplier_bills where id=$1 for update", [billId])).rows[0];
  if (!b || b.journal_id) throw new UserError("This bill is already posted.");
  if (b.match_status === "exception") throw new UserError("A matching exception must be approved before posting.");
  const ls = (await db.query("select bl.*, l.unit_cost_paise po_cost, l.uom_factor_milli from supplier_bill_lines bl join purchase_order_lines l on l.id=bl.po_line_id and l.tenant_id=bl.tenant_id where bl.bill_id=$1", [billId])).rows;
  let grni = 0;
  for (const l of ls) {
    grni += mulDiv(l.qty, l.po_cost, Number(l.uom_factor_milli));
    await db.query("update purchase_order_lines set billed_qty = billed_qty + $2 where id=$1", [l.po_line_id, l.qty]);
    const chk = (await db.query("select received_qty - returned_qty - billed_qty r from purchase_order_lines where id=$1", [l.po_line_id])).rows[0].r;
    if (Number(chk) < 0 && b.match_status !== "exception_approved") throw new UserError("Billed quantity exceeds received quantity.");
  }
  const variance = b.subtotal_paise - grni;
  const lines = [
    { account: "grni", debit: grni }, { account: "ppv", debit: variance > 0 ? variance : 0, credit: variance < 0 ? -variance : 0 },
    { account: "input_tax", debit: b.tax_paise }, { account: "ap", credit: b.total_paise },
  ];
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: b.bill_date, memo: `Supplier bill ${b.number} (${b.supplier_ref})`, sourceType: "supplier_bill", sourceId: billId, lines });
  await db.query("update supplier_bills set journal_id=$2, status='posted' where id=$1", [billId, j]);
}
onDecision("supplier_bill", async (db, ctx, id, ok, reason) => {
  if (!ok) { await db.query("update supplier_bills set status='void', match_status='exception' where id=$1", [id]); return; }
  await db.query("update supplier_bills set match_status='exception_approved' where id=$1", [id]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "bill.exception_approved", entityType: "supplier_bill", entityId: id, reason });
  await postBill(db, ctx, id);
});

export async function paySupplierBill(db: Db, ctx: TCtx, billId: string, amount: number, method: string, reference: string, paidOn: string) {
  const b = (await db.query("select * from supplier_bills where id=$1 for update", [billId])).rows[0];
  if (!b) throw new UserError("Bill not found");
  if (!["posted", "partially_paid"].includes(b.status)) throw new UserError(`A ${b.status} bill cannot be paid.`);
  const due = b.total_paise - b.paid_paise;
  if (amount <= 0 || amount > due) throw new UserError(`Payment must be between ₹0.01 and the balance due (${(due / 100).toFixed(2)}).`, { amount: "Exceeds balance due" });
  const number = await num(db, ctx.tenant.id, "supplier_payment");
  const pid = (await db.query("insert into supplier_payments(tenant_id,number,supplier_id,bill_id,amount_paise,method,reference,paid_on,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [ctx.tenant.id, number, b.supplier_id, billId, amount, method, reference || null, paidOn, ctx.user.id])).rows[0].id;
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: paidOn, memo: `Payment ${number} for ${b.number}`, sourceType: "supplier_payment", sourceId: pid,
    lines: [{ account: "ap", debit: amount }, { account: "cash", credit: amount }] });
  await db.query("update supplier_payments set journal_id=$2 where id=$1", [pid, j]);
  await db.query("update supplier_bills set paid_paise = paid_paise + $2, status = case when paid_paise + $2 >= total_paise then 'paid' else 'partially_paid' end where id=$1", [billId, amount]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "supplier_payment.posted", entityType: "supplier_bill", entityId: billId, detail: { number, amount } });
  return number;
}

export async function supplierPerformance(db: Db, tenantId: string) {
  return (await db.query(
    `select s.id, s.name, count(distinct po.id) orders,
            coalesce(sum(l.qty),0) ordered, coalesce(sum(l.received_qty),0) received, coalesce(sum(l.returned_qty),0) returned,
            round(100.0 * coalesce(sum(l.received_qty),0) / nullif(sum(l.qty),0), 1) fill_rate,
            round(100.0 * coalesce(sum(l.returned_qty),0) / nullif(sum(l.received_qty),0), 1) return_rate
       from suppliers s left join purchase_orders po on po.supplier_id=s.id and po.tenant_id=s.tenant_id and po.status <> 'cancelled'
       left join purchase_order_lines l on l.order_id=po.id and l.tenant_id=po.tenant_id where s.tenant_id=$1 group by s.id, s.name order by s.name`, [tenantId])).rows;
}
