"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { parseMoney, parseQty } from "@/lib/money";
import { readLines, resolveLines } from "@/lib/erp/lines";
import { createPR, submitPR, convertPR, createPO, submitPO, markSent, acknowledgePO, cancelPO, receiveGoods, returnToSupplier, recordBill, paySupplierBill } from "@/lib/erp/procurement";
import { today } from "@/lib/erp/ledger";
import { qtyFields } from "@/lib/erp/qty-fields";

export async function createPRAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.create", form, async (ctx, db) => {
    const f = formObj(form); if (!f.branch_id) throw new UserError("Choose a branch.", { branch_id: "Required" });
    const raw = readLines(form); if (!raw.length) throw new UserError("Add at least one line.");
    const lines = [];
    for (const r of raw) { if (!r.itemId) throw new UserError("Choose an item on every line."); try { lines.push({ itemId: r.itemId, qty: parseQty(r.qty), supplierId: f.supplier_id || undefined, estCost: r.price ? parseMoney(r.price) : 0 }); } catch (e: any) { throw new UserError(e.message); } }
    const pr = await createPR(db, ctx, { branchId: f.branch_id, reason: f.reason, departmentId: f.department_id, lines });
    return { ok: true, message: `Purchase request ${pr.number} saved.`, redirectTo: `/app/procurement/requests/${pr.id}` };
  });
}
export async function submitPRAction(id: string): Promise<ActionResult> {
  return tenantAction("procurement.create", null, async (ctx, db) => { const s = await submitPR(db, ctx, id); return { ok: true, message: s === "approved" ? "Approved (no rule requires approval)." : "Sent for approval." }; });
}
export async function convertPRAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.create", form, async (ctx, db) => {
    const f = formObj(form); if (!f.warehouse_id) throw new UserError("Choose the receiving warehouse.", { warehouse_id: "Required" });
    const pos = await convertPR(db, ctx, id, f.warehouse_id, f.supplier_id || undefined);
    return { ok: true, message: `Created ${pos.map((p) => p.number).join(", ")}.`, redirectTo: pos.length === 1 ? `/app/procurement/orders/${pos[0].id}` : "/app/procurement/orders" };
  });
}
export async function createPOAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.create", form, async (ctx, db) => {
    const f = formObj(form); for (const [k, l] of [["supplier_id", "Supplier"], ["branch_id", "Branch"], ["warehouse_id", "Warehouse"]]) if (!f[k]) throw new UserError(`${l} is required.`, { [k]: "Required" });
    const lines = await resolveLines(db, ctx.tenant.id, readLines(form), { kind: "purchase" });
    const po = await createPO(db, ctx, { supplierId: f.supplier_id, branchId: f.branch_id, warehouseId: f.warehouse_id, expectedDate: f.expected_date, notes: f.notes, lines });
    return { ok: true, message: `Purchase order ${po.number} saved as draft.`, redirectTo: `/app/procurement/orders/${po.id}` };
  });
}
export async function submitPOAction(id: string): Promise<ActionResult> {
  return tenantAction("procurement.create", null, async (ctx, db) => { const s = await submitPO(db, ctx, id); return { ok: true, message: s === "approved" ? "Approved." : "Sent for approval; it can’t be sent to the supplier until approved." }; });
}
export async function sendPOAction(id: string): Promise<ActionResult> {
  return tenantAction("procurement.create", null, async (_c, db) => { await markSent(db, id); return { ok: true, message: "Marked as sent to the supplier." }; });
}
export async function ackPOAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.create", form, async (_c, db) => { const f = formObj(form); if (!f.ref) throw new UserError("Enter the supplier’s reference.", { ref: "Required" }); await acknowledgePO(db, id, f.ref, f.expected_date); return { ok: true, message: "Acknowledgement recorded." }; });
}
export async function cancelPOAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.approve", form, async (ctx, db) => { await cancelPO(db, ctx, id, formObj(form).reason ?? ""); return { ok: true, message: "Purchase order cancelled." }; });
}
export async function receiveAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.receive", form, async (ctx, db) => {
    const f = formObj(form);
    const r = await receiveGoods(db, ctx, id, qtyFields(f, "qty_").map((x) => ({ poLineId: x.id, qty: x.qty })), f.delivery_ref);
    return { ok: true, message: `Goods receipt ${r.number} posted. Stock updated; short-supplied sales orders were topped up automatically.` };
  });
}
export async function supplierReturnAction(lineId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.receive", form, async (ctx, db) => {
    const f = formObj(form); let q: number; try { q = parseQty(f.qty); } catch (e: any) { throw new UserError(e.message, { qty: e.message }); }
    const r = await returnToSupplier(db, ctx, lineId, q, f.reason ?? ""); return { ok: true, message: `Return ${r.number} posted; stock reduced.` };
  });
}
export async function billAction(orderId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.invoice", form, async (ctx, db) => {
    const f = formObj(form); if (!f.supplier_ref) throw new UserError("Enter the supplier’s invoice number.", { supplier_ref: "Required" });
    const lines: { poLineId: string; qty: number; unitCostPaise: number }[] = [];
    for (const q of qtyFields(f, "qty_")) { const p = f[`cost_${q.id}`]; let c: number; try { c = parseMoney(p, "Unit cost"); } catch (e: any) { throw new UserError(e.message, { [`cost_${q.id}`]: e.message }); } lines.push({ poLineId: q.id, qty: q.qty, unitCostPaise: c }); }
    const r = await recordBill(db, ctx, { orderId, supplierRef: f.supplier_ref, billDate: f.bill_date || today(), dueDate: f.due_date || undefined, lines });
    return { ok: true, message: r.exception ? `Bill ${r.number} differs from the order/receipt. It is held for approval.` : `Bill ${r.number} matched and posted.`, redirectTo: `/app/procurement/bills/${r.id}` };
  });
}
export async function payBillAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.receipts", form, async (ctx, db) => {
    const f = formObj(form); let a: number; try { a = parseMoney(f.amount); } catch (e: any) { throw new UserError(e.message, { amount: e.message }); }
    const n = await paySupplierBill(db, ctx, id, a, f.method || "bank", f.reference, f.paid_on || today()); return { ok: true, message: `Payment ${n} recorded.` };
  });
}
