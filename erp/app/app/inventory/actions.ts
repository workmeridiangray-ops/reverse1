"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { parseQty, parseMoney } from "@/lib/money";
import { createTransfer, receiveTransfer, cancelTransfer, recordCount, openingStock } from "@/lib/erp/stock";
import { createPR } from "@/lib/erp/procurement";

const q = (v: string, key: string) => { try { return parseQty(v); } catch (e: any) { throw new UserError(e.message, { [key]: e.message }); } };
export async function transferAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("inventory.post", form, async (ctx, db) => {
    const f = formObj(form); for (const [k, l] of [["item_id", "Item"], ["from", "From warehouse"], ["to", "To warehouse"]]) if (!f[k]) throw new UserError(`${l} is required.`, { [k]: "Required" });
    const t = await createTransfer(db, ctx, { itemId: f.item_id, from: f.from, to: f.to, qty: q(f.qty, "qty") });
    return { ok: true, message: `Transfer ${t.number} shipped. The quantity is now in transit and not available at either warehouse until received.` };
  });
}
export async function receiveTransferAction(id: string): Promise<ActionResult> {
  return tenantAction("inventory.post", null, async (ctx, db) => { await receiveTransfer(db, ctx, id); return { ok: true, message: "Received into the destination warehouse." }; });
}
export async function cancelTransferAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("inventory.post", form, async (ctx, db) => { await cancelTransfer(db, ctx, id, formObj(form).reason ?? ""); return { ok: true, message: "Transfer cancelled; stock returned to the source warehouse." }; });
}
export async function countAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("inventory.adjust", form, async (ctx, db) => {
    const f = formObj(form); if (!f.item_id) throw new UserError("Choose an item.", { item_id: "Required" });
    const c = f.counted === "0" ? 0 : q(f.counted, "counted");
    const r = await recordCount(db, ctx, { warehouseId: f.warehouse_id, itemId: f.item_id, counted: c, reason: f.reason ?? "" });
    return { ok: true, message: r.pending ? `Count ${r.number} needs approval before stock changes.` : `Count ${r.number} posted; stock and ledger adjusted.` };
  });
}
export async function openingAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("inventory.adjust", form, async (ctx, db) => {
    const f = formObj(form); let c: number; try { c = parseMoney(f.cost, "Unit cost"); } catch (e: any) { throw new UserError(e.message, { cost: e.message }); }
    await openingStock(db, ctx, { itemId: f.item_id, warehouseId: f.warehouse_id, qty: q(f.qty, "qty"), unitCost: c });
    return { ok: true, message: "Opening stock loaded and balanced against owner equity." };
  });
}
export async function reorderAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("procurement.create", form, async (ctx, db) => {
    const lines = []; for (const [k, v] of Object.entries(formObj(form))) if (k.startsWith("qty_") && v) lines.push({ itemId: k.slice(4), qty: q(v, k) });
    if (!lines.length) throw new UserError("Select at least one item.");
    const br = (await db.query("select id from branches where tenant_id=$1 and status='active' and ($2::uuid[] is null or id=any($2)) order by created_at limit 1", [ctx.tenant.id, ctx.membership.branchIds])).rows[0];
    const pr = await createPR(db, ctx, { branchId: br.id, reason: "Reorder suggestions", lines });
    return { ok: true, message: `Purchase request ${pr.number} created.`, redirectTo: `/app/procurement/requests/${pr.id}` };
  });
}
