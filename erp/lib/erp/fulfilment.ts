import type { Db } from "../db";
import type { TCtx } from "../actions";
import { UserError } from "../errors";
import { audit } from "../audit";
import { moveStock } from "./inventory";
import { postJournal, today } from "./ledger";
import { mulDiv, lineAmounts } from "../money";
import { refreshFulfilmentStatus } from "./sales";

const num = async (db: Db, t: string, k: string) => (await db.query("select next_number($1,$2) n", [t, k])).rows[0].n as string;

/** Dispatch only what is reserved. Stock and cost of sales post at dispatch; revenue posts at invoice. */
export async function dispatchOrder(db: Db, ctx: TCtx, orderId: string, items: { lineId: string; qty: number }[], carrier?: string, tracking?: string) {
  const o = (await db.query("select * from sales_orders where id=$1 for update", [orderId])).rows[0];
  if (!o) throw new UserError("Order not found");
  if (!["confirmed", "partially_fulfilled"].includes(o.status)) throw new UserError(`A ${o.status.replace("_", " ")} order cannot be dispatched${o.status === "credit_hold" ? " until the credit hold is released" : ""}.`);
  const todo = items.filter((x) => x.qty > 0);
  if (!todo.length) throw new UserError("Enter a dispatch quantity for at least one line.");
  const number = await num(db, ctx.tenant.id, "dispatch");
  const d = (await db.query("insert into dispatches(tenant_id,number,order_id,warehouse_id,carrier,tracking_ref,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [ctx.tenant.id, number, orderId, o.warehouse_id, carrier || null, tracking || null, ctx.user.id])).rows[0].id as string;
  let cogs = 0;
  for (const t of todo) {
    const l = (await db.query("select l.*, i.kind, i.avg_cost_paise, i.name from sales_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.id=$1 and l.order_id=$2 for update of l", [t.lineId, orderId])).rows[0];
    if (!l) throw new UserError("Line does not belong to this order");
    if (l.kind !== "goods") throw new UserError(`${l.name} is a service; invoice it directly.`);
    if (t.qty > l.reserved_qty) throw new UserError(`${l.name}: only ${l.reserved_qty / 1000} is reserved and ready to dispatch (you entered ${t.qty / 1000}). Receive stock or amend the order.`);
    const dl = (await db.query("insert into dispatch_lines(tenant_id,dispatch_id,order_line_id,item_id,qty,unit_cost_paise) values ($1,$2,$3,$4,$5,$6) returning id",
      [ctx.tenant.id, d, l.id, l.item_id, t.qty, l.avg_cost_paise])).rows[0].id;
    await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: l.item_id, warehouseId: o.warehouse_id, delta: -t.qty, kind: "dispatch", unitCost: l.avg_cost_paise, docType: "dispatch", docId: d, docLineId: dl, consumeReserved: true });
    await db.query("update sales_order_lines set reserved_qty = reserved_qty - $2, dispatched_qty = dispatched_qty + $2 where id=$1", [l.id, t.qty]);
    cogs += mulDiv(t.qty, l.avg_cost_paise, 1000);
  }
  if (cogs > 0) {
    const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Dispatch ${number}`, sourceType: "dispatch", sourceId: d,
      lines: [{ account: "cogs", debit: cogs, branchId: o.branch_id }, { account: "inventory", credit: cogs, branchId: o.branch_id }] });
    await db.query("update dispatches set journal_id=$2 where id=$1", [d, j]);
  }
  await refreshFulfilmentStatus(db, orderId);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "dispatch.posted", entityType: "dispatch", entityId: d, detail: { number, cogs } });
  return { id: d, number };
}

export async function markDelivered(db: Db, ctx: TCtx, dispatchId: string, note?: string) {
  const r = await db.query("update dispatches set status='delivered', delivered_at=now(), delivery_note=$2 where id=$1 and status='posted'", [dispatchId, note || null]);
  if (!r.rowCount) throw new UserError("Only dispatched shipments can be marked delivered.");
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "dispatch.delivered", entityType: "dispatch", entityId: dispatchId });
}

// ---- customer returns ----
/** quantity of returns that must be credited because it exceeds the not-yet-invoiced stock */
const creditedQty = (dispatched: number, invoiced: number, returned: number) => Math.max(0, returned - (dispatched - invoiced));

export async function requestReturn(db: Db, ctx: TCtx, lineId: string, qty: number, reason: string) {
  if (reason.trim().length < 3) throw new UserError("Give a reason for the return.", { reason: "Required" });
  const l = (await db.query("select l.*, o.id oid, o.warehouse_id, i.kind from sales_order_lines l join sales_orders o on o.id=l.order_id and o.tenant_id=l.tenant_id join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.id=$1 for update of l", [lineId])).rows[0];
  if (!l) throw new UserError("Order line not found");
  const pending = Number((await db.query("select coalesce(sum(qty),0) s from customer_returns where order_line_id=$1 and status='requested'", [lineId])).rows[0].s);
  const eligible = l.dispatched_qty - l.returned_qty - pending;
  if (qty <= 0 || qty > eligible) throw new UserError(`Only ${Math.max(0, eligible) / 1000} can still be returned for this line (dispatched ${l.dispatched_qty / 1000}, already returned or pending ${(l.returned_qty + pending) / 1000}).`);
  const dl = (await db.query("select avg(unit_cost_paise)::bigint c from dispatch_lines where order_line_id=$1", [lineId])).rows[0];
  const a = lineAmounts(qty, l.unit_price_paise, l.discount_bps, l.tax_bps, Number(l.uom_factor_milli));
  const number = await num(db, ctx.tenant.id, "customer_return");
  const id = (await db.query(
    `insert into customer_returns(tenant_id,number,order_id,order_line_id,item_id,warehouse_id,qty,unit_cost_paise,refund_net_paise,refund_tax_paise,reason,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [ctx.tenant.id, number, l.oid, lineId, l.item_id, l.warehouse_id, qty, Number(dl.c ?? 0), a.net, a.tax, reason, ctx.user.id])).rows[0].id;
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "return.requested", entityType: "customer_return", entityId: id, reason });
  return { id, number };
}

/** Inspection decides stock: only 'restock' goes back on the shelf (once, at original cost). Credit follows invoiced quantity. */
export async function inspectReturn(db: Db, ctx: TCtx, returnId: string, outcome: "restock" | "reject", note: string) {
  const r = (await db.query("select * from customer_returns where id=$1 for update", [returnId])).rows[0];
  if (!r) throw new UserError("Return not found");
  if (r.status !== "requested") throw new UserError(`This return is already ${r.status}.`);
  const l = (await db.query("select * from sales_order_lines where id=$1 for update", [r.order_line_id])).rows[0];
  if (r.qty > l.dispatched_qty - l.returned_qty) throw new UserError("Return quantity is no longer eligible.");
  const before = creditedQty(l.dispatched_qty, l.invoiced_qty, l.returned_qty);
  const after = creditedQty(l.dispatched_qty, l.invoiced_qty, l.returned_qty + r.qty);
  const creditQty = after - before;
  await db.query("update sales_order_lines set returned_qty = returned_qty + $2 where id=$1", [l.id, r.qty]);
  let journal: string | null = null;
  if (outcome === "restock") {
    await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: r.item_id, warehouseId: r.warehouse_id, delta: r.qty, kind: "return_in", unitCost: r.unit_cost_paise, docType: "customer_return", docId: r.id, docLineId: r.id });
    const v = mulDiv(r.qty, r.unit_cost_paise, 1000);
    if (v > 0) journal = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Return ${r.number} restocked`, sourceType: "customer_return", sourceId: r.id,
      lines: [{ account: "inventory", debit: v }, { account: "cogs", credit: v }] });
  }
  let creditNoteId: string | null = null;
  if (creditQty > 0) {
    const inv = (await db.query(
      `select i.* from invoices i join invoice_lines il on il.invoice_id=i.id and il.tenant_id=i.tenant_id where il.order_line_id=$1 and i.status <> 'void' order by i.issue_date desc limit 1`, [l.id])).rows[0];
    const a = lineAmounts(creditQty, l.unit_price_paise, l.discount_bps, l.tax_bps, Number(l.uom_factor_milli));
    creditNoteId = await issueCreditNote(db, ctx, inv.id, a.net, a.tax, `Return ${r.number}: ${r.reason}`, r.id);
  }
  await db.query("update customer_returns set status='closed', outcome=$2, inspection_note=$3, credit_note_id=$4, journal_id=$5 where id=$1", [returnId, outcome, note, creditNoteId, journal]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "return.inspected", entityType: "customer_return", entityId: returnId, detail: { outcome, creditQty }, reason: note });
}

// ---- credit notes (shared with finance) ----
export async function issueCreditNote(db: Db, ctx: TCtx, invoiceId: string, net: number, tax: number, reason: string, returnId?: string): Promise<string> {
  if (reason.trim().length < 3) throw new UserError("A reason is required for a credit note.", { reason: "Required" });
  const inv = (await db.query("select * from invoices where id=$1 for update", [invoiceId])).rows[0];
  if (!inv) throw new UserError("Invoice not found");
  if (inv.status === "void") throw new UserError("A void invoice cannot be credited.");
  const total = net + tax;
  if (total <= 0) throw new UserError("Credit amount must be greater than zero.");
  if (total + inv.credited_paise > inv.total_paise) throw new UserError("Credits cannot exceed the invoice total.");
  const outstanding = inv.total_paise - inv.paid_paise - inv.credited_paise;
  const applied = Math.min(total, outstanding);
  const refundDue = total - applied;
  const number = await num(db, ctx.tenant.id, "credit_note");
  const cn = (await db.query("insert into credit_notes(tenant_id,number,invoice_id,net_paise,tax_paise,reason,refund_due_paise,return_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [ctx.tenant.id, number, invoiceId, net, tax, reason, refundDue, returnId ?? null, ctx.user.id])).rows[0].id as string;
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Credit note ${number} against ${inv.number}`, sourceType: "credit_note", sourceId: cn,
    lines: [{ account: "sales_returns", debit: net, branchId: inv.branch_id }, { account: "output_tax", debit: tax }, { account: "ar", credit: total }] });
  await db.query("update credit_notes set journal_id=$2 where id=$1", [cn, j]);
  const newCredited = inv.credited_paise + applied;
  await db.query("update invoices set credited_paise=$2, status=$3 where id=$1", [invoiceId, newCredited, newCredited + inv.paid_paise >= inv.total_paise ? "paid" : inv.paid_paise + newCredited > 0 ? "partially_paid" : "posted"]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "credit_note.issued", entityType: "credit_note", entityId: cn, reason, detail: { number, total, refundDue } });
  return cn;
}
