import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import * as inv from "./inventory";

export async function createPO(c: Db, x: Ctx, supplierId: string, lines: { itemId: string; qty: number; price: number; dueDate: string; suggestionId?: string }[]) {
  if (!lines.length) throw new UserError("Add at least one line.");
  for (const l of lines) if (!(l.qty > 0)) throw new UserError("Line quantities must be greater than zero.");
  const num = (await c.query("select next_number($1,'po','PO') n", [x.companyId])).rows[0].n;
  const po = await c.query("insert into purchase_orders(company_id,number,supplier_id,created_by) values ($1,$2,$3,$4) returning id", [x.companyId, num, supplierId, x.userId]);
  for (const l of lines) await c.query("insert into purchase_order_lines(company_id,po_id,item_id,qty,unit_price_paise,due_date,suggestion_id) values ($1,$2,$3,$4,$5,$6,$7)", [x.companyId, po.rows[0].id, l.itemId, l.qty, l.price, l.dueDate, l.suggestionId ?? null]);
  await audit(c, actor(x), "po.create", "purchase_order", po.rows[0].id, { number: num });
  return { id: po.rows[0].id as string, number: num as string };
}
export async function submitPO(c: Db, x: Ctx, poId: string) {
  const r = await c.query("update purchase_orders set status='pending_approval', version=version+1 where id=$1 and status='draft' returning id", [poId]);
  if (!r.rowCount) throw new UserError("Only draft orders can be submitted.", "conflict");
  await audit(c, actor(x), "po.submit", "purchase_order", poId);
}
export async function decidePO(c: Db, x: Ctx, poId: string, approve: boolean, reason: string) {
  if (!approve && !reason.trim()) throw new UserError("A reason is required when rejecting.");
  const po = (await c.query("select * from purchase_orders where id=$1 for update", [poId])).rows[0];
  if (!po || po.status !== "pending_approval") throw new UserError("This order is no longer awaiting approval.", "conflict");
  if (po.created_by === x.userId) throw new UserError("You cannot approve a purchase order you created (maker-checker).", "denied");
  await c.query("update purchase_orders set status=$2, approved_by=$3, reject_reason=$4, version=version+1 where id=$1", [poId, approve ? "approved" : "draft", x.userId, approve ? null : reason]);
  await audit(c, actor(x), approve ? "po.approve" : "po.reject", "purchase_order", poId, {}, reason);
}
/** Partial receipts reconcile against the PO line; tracked items land in quarantine until incoming inspection passes. */
export async function receive(c: Db, x: Ctx, poId: string, lines: { lineId: string; qty: number; batchCode?: string }[], invoiceRef: string, locationId: string, key?: string) {
  const po = (await c.query("select * from purchase_orders where id=$1 for update", [poId])).rows[0];
  if (!po || !["approved", "partial"].includes(po.status)) throw new UserError("Only approved purchase orders can be received.", "conflict");
  const rnum = (await c.query("select next_number($1,'grn','GRN') n", [x.companyId])).rows[0].n;
  const rcp = await c.query("insert into receipts(company_id,number,po_id,supplier_invoice_ref,received_by) values ($1,$2,$3,$4,$5) returning id", [x.companyId, rnum, poId, invoiceRef || null, x.userId]);
  let any = false;
  for (const l of lines) {
    if (!(l.qty > 0)) continue;
    const pl = (await c.query("select l.*, i.tracking from purchase_order_lines l join items i on i.id=l.item_id where l.id=$1 and l.po_id=$2 for update of l", [l.lineId, poId])).rows[0];
    if (!pl) throw new UserError("Line does not belong to this order.");
    if (Number(pl.received_qty) + l.qty > Number(pl.qty) + 1e-9) throw new UserError(`Over-receipt: only ${Number(pl.qty) - Number(pl.received_qty)} outstanding on this line.`);
    let batchId: string | null = null;
    if (pl.tracking !== "none") {
      const code = (l.batchCode || `${rnum}-${pl.item_id.slice(0, 4)}`).trim();
      const b = await c.query("insert into batches(company_id,item_id,code,status,supplier_id,source_ref) values ($1,$2,$3,'quarantine',$4,$5) on conflict (company_id,item_id,code) do update set code=excluded.code returning id", [x.companyId, pl.item_id, code, po.supplier_id, po.number]);
      batchId = b.rows[0].id;
      const qn = (await c.query("select next_number($1,'qc','QC') n", [x.companyId])).rows[0].n;
      await c.query("insert into inspections(company_id,number,kind,item_id,batch_id,ref_type,ref_id,qty) values ($1,$2,'incoming',$3,$4,'receipt',$5,$6)", [x.companyId, qn, pl.item_id, batchId, rcp.rows[0].id, l.qty]);
    }
    const id = await inv.post(c, x, { itemId: pl.item_id, batchId, locationId, qty: l.qty, kind: "receipt", refType: "receipt", refId: rcp.rows[0].id, unitCostPaise: pl.unit_price_paise, key: key && `${key}:${l.lineId}` });
    if (!id) continue;
    await c.query("update purchase_order_lines set received_qty = received_qty + $2 where id=$1", [l.lineId, l.qty]);
    any = true;
  }
  if (!any) throw new UserError("Enter a received quantity on at least one line (or this receipt was already posted).");
  const open = await c.query("select 1 from purchase_order_lines where po_id=$1 and received_qty < qty limit 1", [poId]);
  await c.query("update purchase_orders set status=$2 where id=$1", [poId, open.rowCount ? "partial" : "received"]);
  await audit(c, actor(x), "po.receive", "purchase_order", poId, { receipt: rnum, invoiceRef });
  return rnum as string;
}
export async function sendSubcontract(c: Db, x: Ctx, a: { supplierId: string; itemId: string; qty: number; woId?: string; expectedReturn: string; locationId: string; batchId?: string | null }) {
  if (!(a.qty > 0)) throw new UserError("Quantity must be greater than zero.");
  const num = (await c.query("select next_number($1,'sc','SC') n", [x.companyId])).rows[0].n;
  const r = await c.query("insert into subcontract_orders(company_id,number,supplier_id,work_order_id,item_id,qty_sent,expected_return) values ($1,$2,$3,$4,$5,$6,$7) returning id", [x.companyId, num, a.supplierId, a.woId ?? null, a.itemId, a.qty, a.expectedReturn]);
  await inv.post(c, x, { itemId: a.itemId, batchId: a.batchId ?? null, locationId: a.locationId, qty: -a.qty, kind: "subcontract_out", refType: "subcontract", refId: r.rows[0].id, unitCostPaise: await inv.avgCost(c, a.itemId) });
  await audit(c, actor(x), "sc.send", "subcontract_order", r.rows[0].id, { number: num, qty: a.qty });
  return num as string;
}
export async function receiveSubcontract(c: Db, x: Ctx, scId: string, good: number, lost: number, locationId: string, batchId: string | null) {
  const s = (await c.query("select * from subcontract_orders where id=$1 for update", [scId])).rows[0];
  if (!s || s.status === "closed") throw new UserError("Subcontract order is already closed.", "conflict");
  if (good < 0 || lost < 0 || good + lost <= 0) throw new UserError("Enter received and/or lost quantity.");
  if (Number(s.qty_received) + Number(s.qty_lost) + good + lost > Number(s.qty_sent) + 1e-9) throw new UserError("Received + lost cannot exceed the quantity sent.");
  if (good > 0) await inv.post(c, x, { itemId: s.item_id, batchId, locationId, qty: good, kind: "subcontract_in", refType: "subcontract", refId: scId, unitCostPaise: await inv.avgCost(c, s.item_id) });
  const rec = Number(s.qty_received) + good, lst = Number(s.qty_lost) + lost;
  await c.query("update subcontract_orders set qty_received=$2, qty_lost=$3, status=$4 where id=$1", [scId, rec, lst, rec + lst >= Number(s.qty_sent) ? "closed" : "partial"]);
  await audit(c, actor(x), "sc.receive", "subcontract_order", scId, { good, lost });
}
