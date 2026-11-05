import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import * as inv from "./inventory";

export async function createShipment(c: Db, x: Ctx, customerId: string, lines: { soLineId: string; batchId?: string | null; locationId: string; qty: number; serials?: string[] }[]) {
  if (!lines.length) throw new UserError("Add at least one line to the shipment.");
  const num = (await c.query("select next_number($1,'ship','SHP') n", [x.companyId])).rows[0].n;
  const s = await c.query("insert into shipments(company_id,number,customer_id,created_by) values ($1,$2,$3,$4) returning id", [x.companyId, num, customerId, x.userId]);
  for (const l of lines) {
    const sl = (await c.query("select l.*, o.customer_id, o.status ostatus from sales_order_lines l join sales_orders o on o.id=l.order_id where l.id=$1", [l.soLineId])).rows[0];
    if (!sl || sl.customer_id !== customerId) throw new UserError("Order line does not belong to this customer.");
    if (sl.ostatus !== "confirmed") throw new UserError("Only confirmed orders can be shipped.");
    if (l.qty <= 0 || Number(sl.shipped_qty) + l.qty > Number(sl.qty) + 1e-9) throw new UserError(`Cannot ship more than the open quantity (${Number(sl.qty) - Number(sl.shipped_qty)}).`);
    if (l.batchId) { const b = (await c.query("select status from batches where id=$1", [l.batchId])).rows[0]; if (b?.status !== "available") throw new UserError("That batch is in quarantine or rejected and cannot be shipped.", "quarantine"); }
    await c.query("insert into shipment_lines(company_id,shipment_id,so_line_id,item_id,batch_id,location_id,qty,serials) values ($1,$2,$3,$4,$5,$6,$7,$8)", [x.companyId, s.rows[0].id, l.soLineId, sl.item_id, l.batchId ?? null, l.locationId, l.qty, l.serials ?? []]);
  }
  await audit(c, actor(x), "ship.create", "shipment", s.rows[0].id, { number: num });
  return { id: s.rows[0].id as string, number: num as string };
}
export async function dispatch(c: Db, x: Ctx, shipId: string, invoiceRef: string) {
  const s = (await c.query("select * from shipments where id=$1 for update", [shipId])).rows[0];
  if (!s || s.status !== "packing") throw new UserError("Shipment is not in packing.", "conflict");
  const lines = (await c.query("select * from shipment_lines where shipment_id=$1", [shipId])).rows;
  for (const l of lines) {
    await inv.post(c, x, { itemId: l.item_id, batchId: l.batch_id, locationId: l.location_id, qty: -Number(l.qty), kind: "dispatch", refType: "shipment", refId: shipId, key: `ship:${shipId}:${l.id}` });
    await c.query("update sales_order_lines set shipped_qty = shipped_qty + $2 where id=$1", [l.so_line_id, l.qty]);
    if (l.serials.length) {
      const r = await c.query("update serials set status='shipped', shipment_id=$3 where item_id=$1 and serial = any($2) and status='in_stock'", [l.item_id, l.serials, shipId]);
      if (r.rowCount !== l.serials.length) throw new UserError("One or more serial numbers are not in stock (unknown or already shipped).", "duplicate");
    }
  }
  await c.query("update shipments set status='dispatched', dispatched_at=now(), invoice_ref=$2 where id=$1", [shipId, invoiceRef || null]);
  await c.query(`update sales_orders o set status='closed' where o.id in (select order_id from sales_order_lines where id = any($1::uuid[])) and not exists (select 1 from sales_order_lines l where l.order_id=o.id and l.shipped_qty<l.qty)`, [lines.map((l) => l.so_line_id)]);
  await audit(c, actor(x), "ship.dispatch", "shipment", shipId, { invoiceRef });
}
export async function confirmDelivery(c: Db, x: Ctx, shipId: string, note: string) {
  const r = await c.query("update shipments set status='delivered', delivered_at=now(), delivery_note=$2 where id=$1 and status='dispatched' returning id", [shipId, note || null]);
  if (!r.rowCount) throw new UserError("Only dispatched shipments can be confirmed as delivered.", "conflict");
  await audit(c, actor(x), "ship.delivered", "shipment", shipId, { by: x.role });
}
export async function createReturn(c: Db, x: Ctx, shipId: string, itemId: string, qty: number, reason: string) {
  if (!reason.trim()) throw new UserError("A reason is required.");
  const sl = (await c.query("select coalesce(sum(qty),0) q from shipment_lines where shipment_id=$1 and item_id=$2", [shipId, itemId])).rows[0];
  if (qty <= 0 || qty > Number(sl.q)) throw new UserError("Return quantity exceeds what was shipped.");
  const n = (await c.query("select next_number($1,'rma','RMA') n", [x.companyId])).rows[0].n;
  await c.query("insert into returns(company_id,number,shipment_id,item_id,qty,reason) values ($1,$2,$3,$4,$5,$6)", [x.companyId, n, shipId, itemId, qty, reason]);
  await audit(c, actor(x), "return.create", "return", n);
  return n as string;
}
/** Returned goods are never restocked until inspected. */
export async function dispositionReturn(c: Db, x: Ctx, retId: string, restock: boolean, locationId: string, reason: string) {
  const r = (await c.query("select * from returns where id=$1 for update", [retId])).rows[0];
  if (!r || r.status !== "awaiting_inspection") throw new UserError("Return already handled.", "conflict");
  if (!reason.trim()) throw new UserError("Record the inspection finding as the reason.");
  if (restock) await inv.post(c, x, { itemId: r.item_id, locationId, qty: Number(r.qty), kind: "return", refType: "return", refId: retId, unitCostPaise: await inv.avgCost(c, r.item_id) });
  await c.query("update returns set status=$2 where id=$1", [retId, restock ? "restocked" : "scrapped"]);
  await audit(c, actor(x), "return.disposition", "return", retId, { restock }, reason);
}
