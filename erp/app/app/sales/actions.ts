"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { readLines, resolveLines } from "@/lib/erp/lines";
import { createQuote, submitQuote, acceptQuote, reviseQuote, createOrderRaw, confirmOrder, amendOrder, cancelOrder } from "@/lib/erp/sales";
import { requestForShortage } from "@/lib/erp/procurement";
import { parseQty } from "@/lib/money";

const need = (v: string, label: string, key: string) => { if (!v) throw new UserError(`${label} is required.`, { [key]: "Required" }); return v; };

export async function createQuoteAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.create", form, async (ctx, db) => {
    const f = formObj(form); need(f.customer_id, "Customer", "customer_id"); need(f.branch_id, "Branch", "branch_id");
    const lines = await resolveLines(db, ctx.tenant.id, readLines(form), { kind: "sale", customerId: f.customer_id });
    const q = await createQuote(db, ctx, { customerId: f.customer_id, branchId: f.branch_id, validUntil: f.valid_until, notes: f.notes, lines });
    return { ok: true, message: `Quotation ${q.number} saved as draft.`, redirectTo: `/app/sales/quotes/${q.id}` };
  });
}
export async function submitQuoteAction(id: string): Promise<ActionResult> {
  return tenantAction("sales.create", null, async (ctx, db) => { const s = await submitQuote(db, ctx, id); return { ok: true, message: s === "approved" ? "Quotation approved (no approval rule applies)." : "Sent for approval." }; });
}
export async function reviseQuoteAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.create", form, async (ctx, db) => {
    const cust = (await db.query("select customer_id from quotes where id=$1", [id])).rows[0]?.customer_id;
    const lines = await resolveLines(db, ctx.tenant.id, readLines(form), { kind: "sale", customerId: cust });
    const q = await reviseQuote(db, ctx, id, lines, formObj(form).notes);
    return { ok: true, message: `Created ${q.number}; the previous version is kept as superseded.`, redirectTo: `/app/sales/quotes/${q.id}` };
  });
}
export async function acceptQuoteAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.create", form, async (ctx, db) => {
    const o = await acceptQuote(db, ctx, id, need(formObj(form).warehouse_id, "Warehouse", "warehouse_id"));
    return { ok: true, message: `Order ${o.number} created from the accepted quotation at the quoted prices.`, redirectTo: `/app/sales/orders/${o.id}` };
  });
}
export async function createOrderAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.create", form, async (ctx, db) => {
    const f = formObj(form); need(f.customer_id, "Customer", "customer_id"); need(f.branch_id, "Branch", "branch_id"); need(f.warehouse_id, "Warehouse", "warehouse_id");
    const lines = await resolveLines(db, ctx.tenant.id, readLines(form), { kind: "sale", customerId: f.customer_id });
    const o = await createOrderRaw(db, ctx, { customerId: f.customer_id, branchId: f.branch_id, warehouseId: f.warehouse_id, promisedDate: f.promised_date, notes: f.notes, lines });
    return { ok: true, message: `Order ${o.number} saved as draft.`, redirectTo: `/app/sales/orders/${o.id}` };
  });
}
export async function confirmOrderAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.create", form, async (ctx, db) => {
    const f = formObj(form);
    const r = await confirmOrder(db, ctx, id, f.override_reason ? { reason: f.override_reason } : undefined);
    if (r.status === "credit_hold") return { ok: true, message: `Order placed on credit hold: exposure with this order exceeds the credit limit. An authorised user can release it with a reason.` };
    const msg = r.shortages.length ? `Order confirmed. Shortage on ${r.shortages.map((s) => `${s.itemName} (${s.short / 1000})`).join(", ")} — see Shortages.` : "Order confirmed and all stock reserved.";
    return { ok: true, message: msg };
  });
}
export async function amendOrderAction(id: string, version: number, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.create", form, async (ctx, db) => {
    const f = formObj(form); const changes: { lineId: string; newQtyBase: number }[] = [];
    for (const [k, v] of Object.entries(f)) { const m = k.match(/^qty_(.+)$/); if (m && v !== "") { try { changes.push({ lineId: m[1], newQtyBase: parseQty(v) }); } catch (e: any) { throw new UserError(e.message, { [k]: e.message }); } } }
    // only lines whose value differs are applied inside amendOrder
    await amendOrder(db, ctx, id, version, changes, f.reason ?? "");
    return { ok: true, message: "Order amended. Reservations were reconciled." };
  });
}
export async function cancelOrderAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.cancel", form, async (ctx, db) => {
    const r = await cancelOrder(db, ctx, id, formObj(form).reason ?? "");
    return { ok: true, message: (r.partial ? "Undelivered remainder cancelled; delivered goods stay on the order. " : "Order cancelled and reservations released. ") + (r.withdrawnRequests.length ? `Withdrew purchase request(s): ${r.withdrawnRequests.join(", ")}.` : "") };
  });
}
export async function raisePRAction(orderId: string): Promise<ActionResult> {
  return tenantAction("procurement.create", null, async (ctx, db) => { const pr = await requestForShortage(db, ctx, orderId); return { ok: true, message: `Purchase request ${pr.number} created for the uncovered shortage.`, redirectTo: `/app/procurement/requests/${pr.id}` }; });
}
