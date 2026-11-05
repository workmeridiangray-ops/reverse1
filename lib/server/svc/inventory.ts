import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import { can } from "../perms";

export type Move = { itemId: string; batchId?: string | null; locationId: string; qty: number; kind: string; refType?: string; refId?: string; unitCostPaise?: number; key?: string; note?: string };

export async function avgCost(c: Db, itemId: string): Promise<number> {
  const r = await c.query(`select coalesce(sum(qty*unit_cost_paise)/nullif(sum(qty),0),0) avg, (select std_cost_paise from items where id=$1) std
    from stock_movements where item_id=$1 and qty>0 and unit_cost_paise>0`, [itemId]);
  const a = Math.round(Number(r.rows[0].avg)); return a > 0 ? a : Number(r.rows[0].std);
}
export async function post(c: Db, x: Ctx, m: Move) {
  if (m.key) {   // duplicate submission: the earlier posting stands, nothing new is written
    const dup = await c.query("select id from stock_movements where company_id=$1 and idempotency_key=$2", [x.companyId, m.key]);
    if (dup.rowCount) return undefined;
  }
  const r = await c.query(
    `insert into stock_movements(company_id,item_id,batch_id,location_id,qty,kind,ref_type,ref_id,unit_cost_paise,idempotency_key,note,posted_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (company_id,idempotency_key) do nothing returning id`,
    [x.companyId, m.itemId, m.batchId ?? null, m.locationId, m.qty, m.kind, m.refType ?? null, m.refId ?? null, m.unitCostPaise ?? 0, m.key ?? null, m.note ?? null, x.userId]);
  return r.rows[0]?.id as string | undefined;   // undefined = duplicate submission, safely ignored
}
export async function onHand(c: Db, itemId: string, opts: { availableOnly?: boolean } = {}): Promise<number> {
  const r = await c.query(`select coalesce(sum(b.qty),0) q from stock_balances b left join batches ba on ba.id=b.batch_id
     join locations l on l.id=b.location_id where b.item_id=$1 and l.kind='stock' ${opts.availableOnly ? "and (ba.id is null or ba.status='available')" : ""}`, [itemId]);
  return Number(r.rows[0].q);
}
export async function reservedQty(c: Db, itemId: string): Promise<number> {
  const r = await c.query("select coalesce(sum(qty),0) q from reservations where item_id=$1 and status='active'", [itemId]); return Number(r.rows[0].q);
}
export async function reserve(c: Db, x: Ctx, itemId: string, qty: number, refType: string, refId: string) {
  await c.query("select pg_advisory_xact_lock(hashtextextended($1,1))", [x.companyId + itemId]);   // serialise concurrent reservations
  const avail = (await onHand(c, itemId, { availableOnly: true })) - (await reservedQty(c, itemId));
  if (qty > avail + 1e-9) throw new UserError(`Only ${avail} available to reserve (requested ${qty}).`, "shortage");
  await c.query("insert into reservations(company_id,item_id,qty,ref_type,ref_id) values ($1,$2,$3,$4,$5)", [x.companyId, itemId, qty, refType, refId]);
}
export async function reverse(c: Db, x: Ctx, movementId: string, reason: string) {
  if (!reason.trim()) throw new UserError("A reason is required to reverse a stock movement.");
  if (!can(x.role, "inv.adjust")) throw new UserError("You are not allowed to reverse stock movements.", "denied");
  const m = (await c.query("select * from stock_movements where id=$1", [movementId])).rows[0];
  if (!m) throw new UserError("Movement not found.", "notfound");
  if (m.kind === "reversal") throw new UserError("A reversal cannot itself be reversed.");
  const id = await c.query(`insert into stock_movements(company_id,item_id,batch_id,location_id,qty,kind,ref_type,ref_id,unit_cost_paise,reverses_id,note,posted_by)
    values ($1,$2,$3,$4,$5,'reversal',$6,$7,$8,$9,$10,$11) returning id`,
    [x.companyId, m.item_id, m.batch_id, m.location_id, -Number(m.qty), m.ref_type, m.ref_id, m.unit_cost_paise, m.id, "Reversal: " + reason, x.userId])
    .catch((e) => { if (e.code === "23505") throw new UserError("This movement has already been reversed."); throw e; });
  await audit(c, actor(x), "stock.reverse", "stock_movement", movementId, { newId: id.rows[0].id }, reason);
  return id.rows[0].id as string;
}
export async function transfer(c: Db, x: Ctx, itemId: string, batchId: string | null, from: string, to: string, qty: number, key?: string) {
  if (qty <= 0) throw new UserError("Quantity must be greater than zero.");
  if (from === to) throw new UserError("Choose two different locations.");
  await post(c, x, { itemId, batchId, locationId: from, qty: -qty, kind: "transfer_out", key: key && key + ":o" });
  await post(c, x, { itemId, batchId, locationId: to, qty, kind: "transfer_in", key: key && key + ":i" });
}
export async function adjust(c: Db, x: Ctx, itemId: string, batchId: string | null, locationId: string, countedQty: number, reason: string) {
  if (!reason.trim()) throw new UserError("A reason is required for a stock adjustment.");
  if (!can(x.role, "inv.adjust")) throw new UserError("You are not allowed to post stock adjustments.", "denied");
  const sys = Number((await c.query("select coalesce(sum(qty),0) q from stock_movements where item_id=$1 and location_id=$2 and batch_id is not distinct from $3", [itemId, locationId, batchId])).rows[0].q);
  const diff = countedQty - sys;
  if (diff === 0) return { diff: 0 };
  await post(c, x, { itemId, batchId, locationId, qty: diff, kind: "adjust", note: reason, unitCostPaise: diff > 0 ? await avgCost(c, itemId) : 0 });
  await audit(c, actor(x), "stock.adjust", "item", itemId, { sys, counted: countedQty, diff }, reason);
  return { diff };
}
export async function defaultLocation(c: Db, plantId?: string): Promise<string> {
  const r = await c.query(`select id from locations where kind='stock' ${plantId ? "and plant_id=$1" : ""} order by code limit 1`, plantId ? [plantId] : []);
  if (!r.rows[0]) throw new UserError("No stock location exists. Add a warehouse location in Setup first.");
  return r.rows[0].id;
}
export async function locationOfKind(c: Db, kind: string, plantId?: string): Promise<string> {
  const r = await c.query(`select id from locations where kind=$1 ${plantId ? "and plant_id=$2" : ""} order by code limit 1`, plantId ? [kind, plantId] : [kind]);
  if (r.rows[0]) return r.rows[0].id; return defaultLocation(c, plantId);
}
/** Genealogy: forward (where did this batch go) and backward (what went into it). */
export async function forwardTrace(c: Db, batchId: string) {
  const wos = await c.query(`select distinct w.id, w.number, w.item_id, i.code item_code from stock_movements m join work_orders w on w.id=m.ref_id and m.ref_type='work_order'
    join items i on i.id=w.item_id where m.batch_id=$1 and m.kind='issue'`, [batchId]);
  const outBatches = await c.query(`select distinct b.id, b.code, i.code item_code, b.status from stock_movements m join batches b on b.id=m.batch_id join items i on i.id=b.item_id
    where m.kind='output' and m.ref_type='work_order' and m.ref_id = any($1::uuid[])`, [wos.rows.map((w) => w.id)]);
  const batchIds = [batchId, ...outBatches.rows.map((b) => b.id)];
  const ships = await c.query(`select s.id, s.number, s.status, cu.name customer, sl.qty, b.code batch_code, i.code item_code from shipment_lines sl join shipments s on s.id=sl.shipment_id
    join customers cu on cu.id=s.customer_id join items i on i.id=sl.item_id left join batches b on b.id=sl.batch_id where sl.batch_id = any($1::uuid[])`, [batchIds]);
  return { workOrders: wos.rows, outputBatches: outBatches.rows, shipments: ships.rows };
}
export async function backwardTrace(c: Db, batchId: string) {
  const wo = await c.query("select distinct ref_id from stock_movements where batch_id=$1 and kind='output' and ref_type='work_order'", [batchId]);
  const inputs = await c.query(`select distinct b.id, b.code, i.code item_code, b.source_ref, b.status from stock_movements m join batches b on b.id=m.batch_id join items i on i.id=b.item_id
    where m.kind='issue' and m.ref_type='work_order' and m.ref_id = any($1::uuid[]) and m.batch_id is not null`, [wo.rows.map((r) => r.ref_id)]);
  return { inputBatches: inputs.rows };
}
