"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { parseQty } from "@/lib/money";
import { dispatchOrder, markDelivered, requestReturn, inspectReturn } from "@/lib/erp/fulfilment";
import { saveFile } from "@/lib/files";
import { qtyFields } from "@/lib/erp/qty-fields";

export async function dispatchAction(orderId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("inventory.post", form, async (ctx, db) => {
    const f = formObj(form);
    const d = await dispatchOrder(db, ctx, orderId, qtyFields(f, "qty_").map((x) => ({ lineId: x.id, qty: x.qty })), f.carrier, f.tracking);
    return { ok: true, message: `Dispatch ${d.number} posted. Stock and cost of sales are recorded; invoice from the order page.`, redirectTo: `/app/fulfilment/dispatches/${d.id}` };
  });
}
export async function deliveredAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("inventory.post", form, async (ctx, db) => {
    const file = form.get("proof");
    if (file instanceof File && file.size > 0) await saveFile(db, ctx, "dispatch", id, file);
    await markDelivered(db, ctx, id, formObj(form).note);
    return { ok: true, message: "Marked delivered." };
  });
}
export async function requestReturnAction(lineId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("sales.create", form, async (ctx, db) => {
    const f = formObj(form); let q: number; try { q = parseQty(f.qty); } catch (e: any) { throw new UserError(e.message, { qty: e.message }); }
    const r = await requestReturn(db, ctx, lineId, q, f.reason ?? "");
    return { ok: true, message: `Return ${r.number} requested. A warehouse user must inspect it.`, redirectTo: "/app/fulfilment/returns" };
  });
}
export async function inspectReturnAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("inventory.post", form, async (ctx, db) => {
    const f = formObj(form); if (!["restock", "reject"].includes(f.outcome)) throw new UserError("Choose an outcome.", { outcome: "Required" });
    if ((f.note ?? "").length < 3) throw new UserError("Add an inspection note.", { note: "Required" });
    await inspectReturn(db, ctx, id, f.outcome as "restock" | "reject", f.note);
    return { ok: true, message: f.outcome === "restock" ? "Restocked once at original cost; credit note issued if the goods were invoiced." : "Rejected goods stay out of stock; credit note issued if the goods were invoiced." };
  });
}
