import type { Db } from "../db";
import type { TCtx } from "../actions";
import { UserError, ConflictError, AccessDenied } from "../errors";
import { audit } from "../audit";
import { sumLines, type ResolvedLine } from "./lines";
import { requestApproval, ruleFor, onDecision } from "./approvals";
import { reserveStock, releaseReservation } from "./inventory";
import { lineAmounts } from "../money";

const num = async (db: Db, t: string, k: string) => (await db.query("select next_number($1,$2) n", [t, k])).rows[0].n as string;

export async function assertBranch(ctx: TCtx, branchId: string) {
  const s = ctx.membership.branchIds;
  if (s && !s.includes(branchId)) throw new AccessDenied("You are not assigned to that branch.");
}

// ---------------- quotations ----------------
export async function createQuote(db: Db, ctx: TCtx, i: { customerId: string; branchId: string; validUntil?: string; notes?: string; lines: ResolvedLine[]; rootId?: string; version?: number }) {
  await assertBranch(ctx, i.branchId);
  const t = sumLines(i.lines);
  const number = i.rootId ? ((await db.query("select number from quotes where id=$1", [i.rootId])).rows[0].number.split("-v")[0] + `-v${i.version}`) : await num(db, ctx.tenant.id, "quote");
  const q = (await db.query(
    `insert into quotes(tenant_id,number,version,root_id,customer_id,branch_id,valid_until,notes,subtotal_paise,tax_paise,total_paise,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [ctx.tenant.id, number, i.version ?? 1, i.rootId ?? null, i.customerId, i.branchId, i.validUntil || null, i.notes ?? null, t.subtotal, t.tax, t.total, ctx.user.id])).rows[0].id as string;
  if (!i.rootId) await db.query("update quotes set root_id=id where id=$1", [q]);
  let n = 1;
  for (const l of i.lines) {
    await db.query(
      `insert into quote_lines(tenant_id,quote_id,line_no,item_id,qty,uom,uom_factor_milli,unit_price_paise,discount_bps,tax_bps,net_paise,tax_paise,total_paise)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [ctx.tenant.id, q, n++, l.itemId, l.qtyBase, l.uom, l.factorMilli, l.pricePerUom, l.discountBps, l.taxBps, l.net, l.tax, l.total]);
  }
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "quote.created", entityType: "quote", entityId: q, detail: { number, total: t.total } });
  return { id: q, number };
}

export async function submitQuote(db: Db, ctx: TCtx, id: string) {
  const q = (await db.query("select * from quotes where id=$1 for update", [id])).rows[0];
  if (!q) throw new UserError("Quotation not found");
  if (q.status !== "draft") throw new UserError(`Only draft quotations can be submitted (this one is ${q.status}).`);
  const rule = await ruleFor(db, ctx.tenant.id, "quote", q.total_paise);
  if (rule) {
    await db.query("update quotes set status='pending_approval' where id=$1", [id]);
    await requestApproval(db, ctx, { entityType: "quote", entityId: id, ref: q.number, amount: q.total_paise, permission: rule.approver_permission,
      impact: { total: q.total_paise, note: "Approving lets the customer accept this quotation at the stated prices." } });
    return "pending_approval";
  }
  await db.query("update quotes set status='approved' where id=$1", [id]);
  return "approved";
}
onDecision("quote", async (db, _c, id, approved) => {
  await db.query("update quotes set status=$2 where id=$1 and status='pending_approval'", [id, approved ? "approved" : "rejected"]);
});

export async function reviseQuote(db: Db, ctx: TCtx, id: string, lines: ResolvedLine[], notes?: string) {
  const q = (await db.query("select * from quotes where id=$1 for update", [id])).rows[0];
  if (!q) throw new UserError("Quotation not found");
  if (["accepted", "superseded"].includes(q.status)) throw new UserError(`A ${q.status} quotation cannot be revised.`);
  const next = (await db.query("select max(version)+1 v from quotes where root_id=$1", [q.root_id])).rows[0].v;
  await db.query("update quotes set status='superseded' where id=$1", [id]);
  return createQuote(db, ctx, { customerId: q.customer_id, branchId: q.branch_id, validUntil: q.valid_until, notes: notes ?? q.notes, lines, rootId: q.root_id, version: next });
}

export async function acceptQuote(db: Db, ctx: TCtx, id: string, warehouseId: string) {
  const q = (await db.query("select * from quotes where id=$1 for update", [id])).rows[0];
  if (!q) throw new UserError("Quotation not found");
  if (q.status !== "approved") throw new UserError(`Only approved quotations can be accepted (this one is ${q.status.replace("_", " ")}).`);
  if (q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10)) {
    await db.query("update quotes set status='expired' where id=$1", [id]);
    throw new UserError("This quotation has expired. Create a new version with current prices.");
  }
  const lines = (await db.query("select * from quote_lines where quote_id=$1 order by line_no", [id])).rows;
  await db.query("update quotes set status='accepted' where id=$1", [id]);
  const order = await createOrderRaw(db, ctx, {
    customerId: q.customer_id, branchId: q.branch_id, warehouseId, quoteId: id, notes: `From quotation ${q.number}`,
    lines: lines.map((l: any) => ({ itemId: l.item_id, qtyBase: l.qty, uom: l.uom, factorMilli: Number(l.uom_factor_milli), pricePerUom: l.unit_price_paise, discountBps: l.discount_bps, taxBps: l.tax_bps, net: l.net_paise, tax: l.tax_paise, total: l.total_paise, uomQty: Math.round(l.qty * 1000 / Number(l.uom_factor_milli)), itemName: "", kind: "goods" })),
  });
  return order;
}

// ---------------- orders ----------------
export async function createOrderRaw(db: Db, ctx: TCtx, i: { customerId: string; branchId: string; warehouseId: string; promisedDate?: string; notes?: string; quoteId?: string; lines: ResolvedLine[] }) {
  await assertBranch(ctx, i.branchId);
  const wh = (await db.query("select branch_id from warehouses where id=$1 and tenant_id=$2 and status='active'", [i.warehouseId, ctx.tenant.id])).rows[0];
  if (!wh) throw new UserError("Choose an active warehouse.");
  const cust = (await db.query("select status from customers where id=$1 and tenant_id=$2", [i.customerId, ctx.tenant.id])).rows[0];
  if (!cust) throw new UserError("Customer not found");
  if (cust.status !== "active") throw new UserError("That customer is retired. Reactivate them first or pick another customer.");
  const t = sumLines(i.lines);
  const number = await num(db, ctx.tenant.id, "sales_order");
  const o = (await db.query(
    `insert into sales_orders(tenant_id,number,quote_id,customer_id,branch_id,warehouse_id,promised_date,notes,subtotal_paise,tax_paise,total_paise,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [ctx.tenant.id, number, i.quoteId ?? null, i.customerId, i.branchId, i.warehouseId, i.promisedDate || null, i.notes ?? null, t.subtotal, t.tax, t.total, ctx.user.id])).rows[0].id as string;
  let n = 1;
  for (const l of i.lines) {
    await db.query(
      `insert into sales_order_lines(tenant_id,order_id,line_no,item_id,qty,uom,uom_factor_milli,uom_qty,unit_price_paise,discount_bps,tax_bps,net_paise,tax_paise,total_paise)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [ctx.tenant.id, o, n++, l.itemId, l.qtyBase, l.uom, l.factorMilli, l.uomQty, l.pricePerUom, l.discountBps, l.taxBps, l.net, l.tax, l.total]);
  }
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "order.created", entityType: "sales_order", entityId: o, detail: { number, total: t.total } });
  return { id: o, number };
}

/** Receivable exposure: unpaid invoices + value of confirmed-but-not-yet-invoiced orders. */
export async function creditExposure(db: Db, tenantId: string, customerId: string, excludeOrder?: string) {
  const ar = Number((await db.query("select coalesce(sum(total_paise - paid_paise - credited_paise),0) s from invoices where tenant_id=$1 and customer_id=$2 and status in ('posted','partially_paid')", [tenantId, customerId])).rows[0].s);
  const open = Number((await db.query(
    `select coalesce(sum(l.total_paise * (l.qty - l.invoiced_qty) / l.qty),0)::bigint s from sales_order_lines l join sales_orders o on o.id=l.order_id and o.tenant_id=l.tenant_id
      where o.tenant_id=$1 and o.customer_id=$2 and o.status in ('confirmed','partially_fulfilled','credit_hold') and ($3::uuid is null or o.id <> $3)`, [tenantId, customerId, excludeOrder ?? null])).rows[0].s);
  return { ar, open };
}

export interface ConfirmResult { status: string; shortages: { itemName: string; short: number }[]; creditHold?: { limit: number; exposure: number; orderTotal: number } }

export async function confirmOrder(db: Db, ctx: TCtx, id: string, override?: { reason: string }): Promise<ConfirmResult> {
  const o = (await db.query("select * from sales_orders where id=$1 for update", [id])).rows[0];
  if (!o) throw new UserError("Order not found");
  if (!["draft", "credit_hold"].includes(o.status)) throw new UserError(`Only draft or credit-hold orders can be confirmed (this one is ${o.status.replace("_", " ")}).`);
  const cust = (await db.query("select * from customers where id=$1", [o.customer_id])).rows[0];
  const exp = await creditExposure(db, ctx.tenant.id, o.customer_id, id);
  const over = cust.credit_limit_paise > 0 && exp.ar + exp.open + o.total_paise > cust.credit_limit_paise;
  if (over) {
    if (!override) {
      await db.query("update sales_orders set status='credit_hold', row_version=row_version+1 where id=$1", [id]);
      await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "order.credit_hold", entityType: "sales_order", entityId: id, detail: { limit: cust.credit_limit_paise, exposure: exp.ar + exp.open, orderTotal: o.total_paise } });
      return { status: "credit_hold", shortages: [], creditHold: { limit: cust.credit_limit_paise, exposure: exp.ar + exp.open, orderTotal: o.total_paise } };
    }
    if (!ctx.perms.has("sales.credit_override")) throw new AccessDenied("Only authorised users can override a credit hold.");
    if (override.reason.trim().length < 5) throw new UserError("Give a reason (at least 5 characters) for the credit override.", { reason: "Required" });
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "order.credit_override", entityType: "sales_order", entityId: id, reason: override.reason, detail: { limit: cust.credit_limit_paise, exposure: exp.ar + exp.open, orderTotal: o.total_paise } });
  }
  const lines = (await db.query(
    "select l.*, i.kind, i.name from sales_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.order_id=$1 order by l.line_no for update of l", [id])).rows;
  const shortages: ConfirmResult["shortages"] = [];
  for (const l of lines) {
    if (l.kind !== "goods") continue;
    const want = l.qty - l.reserved_qty - l.dispatched_qty;
    const got = await reserveStock(db, ctx.tenant.id, l.item_id, o.warehouse_id, want);
    if (got > 0) await db.query("update sales_order_lines set reserved_qty = reserved_qty + $2 where id=$1", [l.id, got]);
    if (got < want) shortages.push({ itemName: l.name, short: want - got });
  }
  await db.query("update sales_orders set status='confirmed', credit_override_reason=$2, row_version=row_version+1 where id=$1", [id, override?.reason ?? null]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "order.confirmed", entityType: "sales_order", entityId: id, detail: { shortages: shortages.length } });
  return { status: "confirmed", shortages };
}

/** Quantity changes on a live order. Reconciles reservations; refuses anything below what is already dispatched. */
export async function amendOrder(db: Db, ctx: TCtx, id: string, expectedVersion: number, changes: { lineId: string; newQtyBase: number }[], reason: string) {
  if (reason.trim().length < 5) throw new UserError("Give a reason for the amendment.", { reason: "Required" });
  const o = (await db.query("select * from sales_orders where id=$1 for update", [id])).rows[0];
  if (!o) throw new UserError("Order not found");
  if (o.row_version !== expectedVersion) throw new ConflictError();
  if (!["confirmed", "credit_hold", "partially_fulfilled"].includes(o.status))
    throw new UserError(`A ${o.status.replace("_", " ")} order cannot be amended. Create a return or a new order instead.`);
  for (const c of changes) {
    const l = (await db.query("select l.*, i.kind from sales_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.id=$1 and l.order_id=$2 for update of l", [c.lineId, id])).rows[0];
    if (!l) throw new UserError("Line not found on this order");
    if (c.newQtyBase === l.qty) continue;
    if (c.newQtyBase < l.dispatched_qty || c.newQtyBase < l.invoiced_qty) throw new UserError(`Line ${l.line_no}: cannot go below the ${l.dispatched_qty / 1000} already dispatched.`);
    if (c.newQtyBase <= 0) throw new UserError("Quantity must be positive; cancel the order to remove it.");
    const a = lineAmounts(c.newQtyBase, l.unit_price_paise, l.discount_bps, l.tax_bps, Number(l.uom_factor_milli));
    let reserved = l.reserved_qty;
    const maxReserved = c.newQtyBase - l.dispatched_qty;
    if (reserved > maxReserved) { await releaseReservation(db, ctx.tenant.id, l.item_id, o.warehouse_id, reserved - maxReserved); reserved = maxReserved; }
    else if (l.kind === "goods" && o.status !== "credit_hold") reserved += await reserveStock(db, ctx.tenant.id, l.item_id, o.warehouse_id, maxReserved - reserved);
    await db.query(
      "update sales_order_lines set qty=$2, uom_qty=$3, net_paise=$4, tax_paise=$5, total_paise=$6, reserved_qty=$7 where id=$1",
      [l.id, c.newQtyBase, Math.round(c.newQtyBase * 1000 / Number(l.uom_factor_milli)), a.net, a.tax, a.total, reserved]);
    // an open purchase request raised for this order may now be larger than the need: flag it
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "order.amended", entityType: "sales_order", entityId: id, reason, detail: { line: l.line_no, from: l.qty, to: c.newQtyBase } });
  }
  const t = (await db.query("select coalesce(sum(net_paise),0) n, coalesce(sum(tax_paise),0) x, coalesce(sum(total_paise),0) t from sales_order_lines where order_id=$1", [id])).rows[0];
  await db.query("update sales_orders set subtotal_paise=$2, tax_paise=$3, total_paise=$4, row_version=row_version+1 where id=$1", [id, t.n, t.x, t.t]);
  await refreshFulfilmentStatus(db, id);
}

export async function refreshFulfilmentStatus(db: Db, orderId: string) {
  const o = (await db.query("select status from sales_orders where id=$1", [orderId])).rows[0];
  if (!["confirmed", "partially_fulfilled", "fulfilled"].includes(o.status)) return;
  const s = (await db.query("select sum(qty) q, sum(dispatched_qty) d from sales_order_lines where order_id=$1", [orderId])).rows[0];
  const st = Number(s.d) >= Number(s.q) ? "fulfilled" : Number(s.d) > 0 ? "partially_fulfilled" : "confirmed";
  await db.query("update sales_orders set status=$2 where id=$1", [orderId, st]);
}

export async function cancelOrder(db: Db, ctx: TCtx, id: string, reason: string) {
  if (reason.trim().length < 5) throw new UserError("Give a reason for cancelling.", { reason: "Required" });
  const o = (await db.query("select * from sales_orders where id=$1 for update", [id])).rows[0];
  if (!o) throw new UserError("Order not found");
  if (["cancelled", "closed"].includes(o.status)) throw new UserError(`This order is already ${o.status}.`);
  const lines = (await db.query("select * from sales_order_lines where order_id=$1 for update", [id])).rows;
  const dispatched = lines.reduce((s: number, l: any) => s + Number(l.dispatched_qty), 0);
  for (const l of lines) {
    if (l.reserved_qty > 0) await releaseReservation(db, ctx.tenant.id, l.item_id, o.warehouse_id, l.reserved_qty);
  }
  if (dispatched === 0) {
    await db.query("update sales_order_lines set reserved_qty=0 where order_id=$1", [id]);
    await db.query("update sales_orders set status='cancelled', cancel_reason=$2, row_version=row_version+1 where id=$1", [id, reason]);
  } else {
    // goods already left: close the undelivered remainder instead of cancelling history
    for (const l of lines) {
      const a = lineAmounts(l.dispatched_qty, l.unit_price_paise, l.discount_bps, l.tax_bps, Number(l.uom_factor_milli));
      await db.query("update sales_order_lines set qty=dispatched_qty, reserved_qty=0, uom_qty=round(dispatched_qty*1000.0/uom_factor_milli), net_paise=$2, tax_paise=$3, total_paise=$4 where id=$1", [l.id, a.net, a.tax, a.total]);
    }
    await db.query("delete from sales_order_lines where order_id=$1 and qty=0", [id]);
    const t = (await db.query("select coalesce(sum(net_paise),0) n, coalesce(sum(tax_paise),0) x, coalesce(sum(total_paise),0) t from sales_order_lines where order_id=$1", [id])).rows[0];
    await db.query("update sales_orders set status='fulfilled', subtotal_paise=$2, tax_paise=$3, total_paise=$4, cancel_reason=$5, row_version=row_version+1 where id=$1", [id, t.n, t.x, t.t, "Remainder cancelled: " + reason]);
  }
  // procurement implication: withdraw purchase requests raised for this order that have not become purchase orders
  const prs = (await db.query("update purchase_requests set status='cancelled' where source_order_id=$1 and status in ('draft','pending_approval','approved') returning number", [id])).rows;
  await db.query("update approval_requests set status='cancelled' where status='pending' and entity_type='purchase_request' and entity_id in (select id from purchase_requests where source_order_id=$1)", [id]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "order.cancelled", entityType: "sales_order", entityId: id, reason, detail: { dispatched, withdrawnRequests: prs.map((p: any) => p.number) } });
  return { withdrawnRequests: prs.map((p: any) => p.number as string), partial: dispatched > 0 };
}

export async function shortageLines(db: Db, tenantId: string, orderId?: string) {
  return (await db.query(
    `select o.id order_id, o.number, o.status, c.name customer, l.id line_id, i.id item_id, i.sku, i.name item, o.warehouse_id,
            (l.qty - l.reserved_qty - l.dispatched_qty) short,
            coalesce((select sum(prl.qty) from purchase_request_lines prl join purchase_requests pr on pr.id=prl.request_id and pr.tenant_id=prl.tenant_id
                       where pr.source_order_id=o.id and prl.item_id=i.id and pr.status in ('draft','pending_approval','approved','converted')),0) requested
       from sales_order_lines l join sales_orders o on o.id=l.order_id and o.tenant_id=l.tenant_id
       join items i on i.id=l.item_id and i.tenant_id=l.tenant_id join customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id
      where o.tenant_id=$1 and o.status in ('confirmed','partially_fulfilled') and i.kind='goods' and l.qty > l.reserved_qty + l.dispatched_qty
        and ($2::uuid is null or o.id=$2) order by o.created_at`, [tenantId, orderId ?? null])).rows;
}
