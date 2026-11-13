import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import * as inv from "./inventory";
import { loadBoms } from "./engineering";
import { componentQty } from "@/lib/domain/bom";
import { addDays, iso } from "@/lib/domain/dates";
import { can } from "../perms";
import { notifyPerm } from "../notify";

const OVER_ISSUE_TOLERANCE = 0.1, OVER_OUTPUT_TOLERANCE = 0;

export async function createWO(c: Db, x: Ctx, a: { itemId: string; qty: number; dueDate: string; plantId: string; soLineId?: string | null; suggestionId?: string | null }) {
  if (!(a.qty > 0)) throw new UserError("Quantity must be greater than zero.");
  const item = (await c.query("select kind, revision, active from items where id=$1", [a.itemId])).rows[0];
  if (!item || !item.active) throw new UserError("Item not found or inactive.");
  if (item.kind === "buy") throw new UserError("Purchased items are bought, not manufactured. Raise a purchase order instead.");
  const num = (await c.query("select next_number($1,'wo','WO') n", [x.companyId])).rows[0].n;
  const r = await c.query(`insert into work_orders(company_id,number,item_id,plant_id,qty,due_date,so_line_id,suggestion_id,item_revision) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [x.companyId, num, a.itemId, a.plantId, a.qty, a.dueDate, a.soLineId ?? null, a.suggestionId ?? null, item.revision]);
  await audit(c, actor(x), "wo.create", "work_order", r.rows[0].id, { number: num, qty: a.qty });
  return { id: r.rows[0].id as string, number: num as string };
}
/** Release snapshots the engineering basis: later BOM/routing changes cannot alter this job. */
export async function releaseWO(c: Db, x: Ctx, woId: string) {
  const wo = (await c.query("select * from work_orders where id=$1 for update", [woId])).rows[0];
  if (!wo) throw new UserError("Work order not found.", "notfound");
  if (wo.status !== "planned") throw new UserError(`Work order is ${wo.status}; only planned orders can be released.`, "conflict");
  const boms = await loadBoms(c, iso(new Date()));
  const bom = boms.get(wo.item_id);
  const routing = (await c.query("select id, version from routings where item_id=$1 and status='released' order by version desc limit 1", [wo.item_id])).rows[0];
  if (!routing) throw new UserError("No released routing for this item. Release a routing before releasing the job.");
  const ops = (await c.query("select * from routing_ops where routing_id=$1 order by seq", [routing.id])).rows;
  if (!ops.length) throw new UserError("The routing has no operations.");
  const lines = bom ? bom.lines : [];
  await c.query("update work_orders set status='released', released_at=now(), bom_snapshot=$2, routing_snapshot=$3, version=version+1 where id=$1",
    [woId, JSON.stringify({ itemId: wo.item_id, bomVersion: bom?.version ?? null, yieldPct: bom?.yieldPct ?? 100, lines }), JSON.stringify({ routingId: routing.id, version: routing.version, ops })]);
  for (const l of lines) {
    const q = componentQty(Number(wo.qty), l, bom!.yieldPct);
    await c.query("insert into wo_materials(company_id,work_order_id,item_id,planned_qty) values ($1,$2,$3,$4)", [x.companyId, woId, l.component, q]);
    const avail = (await inv.onHand(c, l.component, { availableOnly: true })) - (await inv.reservedQty(c, l.component));
    const take = Math.max(0, Math.min(q, avail));
    if (take > 0) await c.query("insert into reservations(company_id,item_id,qty,ref_type,ref_id) values ($1,$2,$3,'work_order',$4)", [x.companyId, l.component, take, woId]);
  }
  let start = iso(new Date());
  for (const op of ops) {
    const planned = Number(op.setup_min) + Number(op.run_min_per_unit) * Number(wo.qty);
    const wc = (await c.query("select hours_per_day from work_centres where id=$1", [op.work_centre_id])).rows[0];
    const days = Math.max(1, Math.ceil(planned / (Number(wc.hours_per_day) * 60)));
    const end = addDays(start, days - 1);
    await c.query(`insert into wo_operations(company_id,work_order_id,seq,name,work_centre_id,planned_min,planned_start,planned_end,subcontract) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [x.companyId, woId, op.seq, op.name, op.work_centre_id, planned, start, end, !!op.subcontract_supplier_id]);
    start = addDays(end, 1);
  }
  await audit(c, actor(x), "wo.release", "work_order", woId, { bomVersion: bom?.version ?? null, routingVersion: routing.version });
}
export async function materialShortage(c: Db, woId: string) {
  const r = await c.query(`select m.item_id, i.code, i.name, m.planned_qty, m.issued_qty, (m.planned_qty - m.issued_qty) need from wo_materials m join items i on i.id=m.item_id where m.work_order_id=$1`, [woId]);
  const out = [];
  for (const m of r.rows) { const avail = (await inv.onHand(c, m.item_id, { availableOnly: true })); out.push({ ...m, available: avail, short: Math.max(0, Number(m.need) - avail) }); }
  return out;
}
export async function issueMaterial(c: Db, x: Ctx, woId: string, itemId: string, qty: number, batchId: string | null, locationId: string, overrideReason?: string, key?: string) {
  if (!(qty > 0)) throw new UserError("Quantity must be greater than zero.");
  const wo = (await c.query("select status, number from work_orders where id=$1 for update", [woId])).rows[0];
  if (!wo || !["released", "in_progress"].includes(wo.status)) throw new UserError("Material can only be issued to a released or in-progress work order.", "conflict");
  let mat = (await c.query("select * from wo_materials where work_order_id=$1 and item_id=$2 for update", [woId, itemId])).rows[0];
  let matItem = itemId;
  if (!mat) {
    const sub = await c.query("select m.* from wo_materials m join bom_substitutes_v s on s.item_id=m.item_id where m.work_order_id=$1 and s.alt_id=$2 limit 1", [woId, itemId]);
    if (!sub.rowCount) throw new UserError("This item is not on the job's bill of materials and is not an approved substitute.");
    mat = sub.rows[0]; matItem = mat.item_id;
    await audit(c, actor(x), "wo.substitute_issue", "work_order", woId, { substitute: itemId, for: matItem });
  }
  const planned = Number(mat.planned_qty), issued = Number(mat.issued_qty);
  if (issued + qty > planned * (1 + OVER_ISSUE_TOLERANCE) + 1e-9) {
    if (!overrideReason?.trim() || !can(x.role, "prod.write")) throw new UserError(`Issue would exceed planned ${planned} (+${OVER_ISSUE_TOLERANCE * 100}% allowance). A supervisor must enter a reason to over-issue.`, "review");
    await audit(c, actor(x), "wo.over_issue", "work_order", woId, { itemId, qty, planned, issued }, overrideReason);
  }
  const cost = await inv.avgCost(c, itemId);
  const id = await inv.post(c, x, { itemId, batchId, locationId, qty: -qty, kind: "issue", refType: "work_order", refId: woId, unitCostPaise: cost, key });
  if (!id) return { duplicate: true };
  await c.query("update wo_materials set issued_qty = issued_qty + $3 where work_order_id=$1 and item_id=$2", [woId, matItem, qty]);
  await c.query("update reservations set status='consumed' where id = (select id from reservations where ref_type='work_order' and ref_id=$1 and item_id=$2 and status='active' order by created_at limit 1) and qty <= $3", [woId, itemId, qty]);
  await c.query("update work_orders set status='in_progress' where id=$1 and status='released'", [woId]);
  return { id };
}
export async function opAction(c: Db, x: Ctx, opId: string, action: "start" | "pause" | "finish") {
  const op = (await c.query("select o.*, w.status wo_status from wo_operations o join work_orders w on w.id=o.work_order_id where o.id=$1 for update of o", [opId])).rows[0];
  if (!op) throw new UserError("Operation not found.", "notfound");
  if (!["released", "in_progress"].includes(op.wo_status)) throw new UserError("The work order is not open for execution.", "conflict");
  if (action === "start") {
    if (op.status === "running") throw new UserError("Already running.", "conflict");
    if (op.status === "done") throw new UserError("This operation is finished.", "conflict");
    const prev = await c.query("select 1 from wo_operations where work_order_id=$1 and seq<$2 and status<>'done' limit 1", [op.work_order_id, op.seq]);
    if (prev.rowCount) throw new UserError("A previous operation is not finished. Operations run in sequence.", "conflict");
    await c.query("update wo_operations set status='running', started_at=now(), actual_start=coalesce(actual_start,now()), operator_id=$2 where id=$1", [opId, x.userId]);
    await c.query("update work_orders set status='in_progress' where id=$1 and status='released'", [op.work_order_id]);
  } else {
    if (op.status !== "running") throw new UserError("The operation is not running.", "conflict");
    const mins = `extract(epoch from (now()-started_at))/60`;
    await c.query(`update wo_operations set actual_min = actual_min + ${mins}, started_at=null, status=$2, actual_end = case when $2='done' then now() else actual_end end where id=$1`, [opId, action === "pause" ? "paused" : "done"]);
  }
  await audit(c, actor(x), "op." + action, "wo_operation", opId, { woId: op.work_order_id });
}
export async function reportOutput(c: Db, x: Ctx, woId: string, good: number, scrap: number, batchCode: string, serials: string[], locationId: string, key?: string) {
  if (good < 0 || scrap < 0 || good + scrap <= 0) throw new UserError("Enter a good or scrap quantity.");
  const wo = (await c.query("select w.*, i.tracking, i.std_cost_paise from work_orders w join items i on i.id=w.item_id where w.id=$1 for update of w", [woId])).rows[0];
  if (!wo || !["released", "in_progress"].includes(wo.status)) throw new UserError("Output can only be reported on an open work order.", "conflict");
  const open = await c.query("select 1 from wo_operations where work_order_id=$1 and status<>'done' and seq < (select max(seq) from wo_operations where work_order_id=$1) limit 1", [woId]);
  if (open.rowCount) throw new UserError("Earlier operations are not finished. Finish them before reporting final output.", "conflict");
  const issuedAny = await c.query("select coalesce(sum(issued_qty),0) s from wo_materials where work_order_id=$1", [woId]);
  const hasMats = await c.query("select 1 from wo_materials where work_order_id=$1 limit 1", [woId]);
  if (hasMats.rowCount && Number(issuedAny.rows[0].s) <= 0) throw new UserError("No material has been issued to this job yet.");
  // Material-based ceiling: output cannot exceed what the issued materials could make without review.
  const mats = (await c.query("select planned_qty, issued_qty from wo_materials where work_order_id=$1", [woId])).rows;
  const snap = wo.bom_snapshot ?? {};
  const ratio = mats.length ? Math.min(...mats.map((m) => Number(m.issued_qty) / Number(m.planned_qty))) : 1;
  const maxByMaterial = Number(wo.qty) * ratio * (1 + OVER_ISSUE_TOLERANCE);
  if (Number(wo.completed_qty) + Number(wo.scrap_qty) + good + scrap > Math.max(maxByMaterial, 0) + 1e-9 && mats.length)
    throw new UserError(`Output would exceed what the issued material supports (${maxByMaterial.toFixed(2)}). Issue more material or ask a supervisor to review.`, "review");
  if (Number(wo.completed_qty) + good > Number(wo.qty) * (1 + OVER_OUTPUT_TOLERANCE) + 1e-9)
    throw new UserError(`Good output would exceed the ordered quantity of ${wo.qty}. A supervisor must amend the order.`, "review");
  void snap;
  let batchId: string | null = null;
  if (good > 0) {
    if (wo.tracking === "serial" && serials.length !== good) throw new UserError(`Enter exactly ${good} serial numbers (got ${serials.length}).`);
    if (wo.tracking !== "none") {
      if (!batchCode.trim()) throw new UserError("A batch code is required for this item.");
      const b = await c.query("insert into batches(company_id,item_id,code,status,source_ref) values ($1,$2,$3,'quarantine',$4) on conflict (company_id,item_id,code) do update set code=excluded.code returning id", [x.companyId, wo.item_id, batchCode.trim(), wo.number]);
      batchId = b.rows[0].id;
      const num = (await c.query("select next_number($1,'qc','QC') n", [x.companyId])).rows[0].n;
      const ii = await c.query("insert into inspections(company_id,number,kind,item_id,batch_id,ref_type,ref_id,qty) values ($1,$2,'final',$3,$4,'work_order',$5,$6) returning id", [x.companyId, num, wo.item_id, batchId, woId, good]);
      await (await import("./extras")).applyPlan(c, ii.rows[0].id, wo.item_id, "final");
    }
    const dup = serials.length ? await c.query("select serial from serials where item_id=$1 and serial = any($2)", [wo.item_id, serials]) : { rowCount: 0, rows: [] };
    if (dup.rowCount) throw new UserError(`Serial number already used: ${dup.rows[0].serial}`, "duplicate");
    if (new Set(serials).size !== serials.length) throw new UserError("Duplicate serial numbers in this entry.", "duplicate");
    for (const s of serials) await c.query("insert into serials(company_id,item_id,serial,batch_id,work_order_id) values ($1,$2,$3,$4,$5)", [x.companyId, wo.item_id, s, batchId, woId]);
    const id = await inv.post(c, x, { itemId: wo.item_id, batchId, locationId, qty: good, kind: "output", refType: "work_order", refId: woId, unitCostPaise: Number(wo.std_cost_paise), key });
    if (!id) return { duplicate: true };
  }
  await c.query("update work_orders set completed_qty = completed_qty + $2, scrap_qty = scrap_qty + $3 where id=$1", [woId, good, scrap]);
  await audit(c, actor(x), "wo.output", "work_order", woId, { good, scrap, batch: batchCode });
  return { ok: true };
}
export async function completeWO(c: Db, x: Ctx, woId: string, shortReason?: string) {
  const wo = (await c.query("select * from work_orders where id=$1 for update", [woId])).rows[0];
  if (!wo || !["released", "in_progress"].includes(wo.status)) throw new UserError("Work order is not open.", "conflict");
  const open = await c.query("select 1 from wo_operations where work_order_id=$1 and status<>'done' limit 1", [woId]);
  if (open.rowCount) throw new UserError("Finish all operations first.", "conflict");
  if (Number(wo.completed_qty) < Number(wo.qty) && !shortReason?.trim()) throw new UserError(`Only ${wo.completed_qty} of ${wo.qty} completed. Enter a reason to close short.`, "review");
  await c.query("update work_orders set status='completed' where id=$1", [woId]);
  await c.query("update reservations set status='released' where ref_type='work_order' and ref_id=$1 and status='active'", [woId]);
  await audit(c, actor(x), "wo.complete", "work_order", woId, { completed: wo.completed_qty, of: wo.qty }, shortReason);
}
export async function createRework(c: Db, x: Ctx, parentId: string, qty: number, reason: string) {
  if (!reason.trim()) throw new UserError("A reason is required for rework.");
  const p = (await c.query("select * from work_orders where id=$1", [parentId])).rows[0];
  if (!p) throw new UserError("Parent job not found.", "notfound");
  const num = (await c.query("select next_number($1,'wo','WO') n", [x.companyId])).rows[0].n;
  const r = await c.query(`insert into work_orders(company_id,number,item_id,plant_id,qty,due_date,parent_wo_id,is_rework,status,item_revision,released_at,bom_snapshot,routing_snapshot)
    values ($1,$2,$3,$4,$5,$6,$7,true,'released',$8,now(),$9,$10) returning id`, [x.companyId, num, p.item_id, p.plant_id, qty, addDays(iso(new Date()), 3), parentId, p.item_revision, JSON.stringify({ itemId: p.item_id, rework: true, lines: [] }), JSON.stringify({ rework: true })]);
  const wc = (await c.query("select work_centre_id from wo_operations where work_order_id=$1 order by seq desc limit 1", [parentId])).rows[0];
  if (wc) await c.query("insert into wo_operations(company_id,work_order_id,seq,name,work_centre_id,planned_min,planned_start,planned_end) values ($1,$2,10,'Rework',$3,$4,current_date,current_date)", [x.companyId, r.rows[0].id, wc.work_centre_id, qty * 15]);
  await audit(c, actor(x), "wo.rework", "work_order", r.rows[0].id, { parent: p.number, qty }, reason);
  return { id: r.rows[0].id as string, number: num as string };
}
/** Supervisor correction: reduces reported good output with a reversing stock movement. */
export async function correctOutput(c: Db, x: Ctx, woId: string, qty: number, reason: string) {
  if (!can(x.role, "prod.write")) throw new UserError("Only a supervisor can correct output.", "denied");
  if (!reason.trim()) throw new UserError("A reason is required.");
  const wo = (await c.query("select completed_qty from work_orders where id=$1 for update", [woId])).rows[0];
  if (qty <= 0 || qty > Number(wo.completed_qty)) throw new UserError("Correction must be between 0 and the reported output.");
  const m = (await c.query("select * from stock_movements where ref_id=$1 and kind='output' and qty>0 and not exists (select 1 from stock_movements r where r.reverses_id=stock_movements.id) order by seq desc", [woId])).rows;
  let left = qty;
  for (const mv of m) {
    if (left <= 0) break;
    const take = Math.min(left, Number(mv.qty));
    if (take < Number(mv.qty)) throw new UserError("Correct whole output postings only; reverse the posting that is wrong.");
    await inv.reverse(c, { ...x, role: can(x.role, "inv.adjust") ? x.role : "manager" }, mv.id, "Supervisor output correction: " + reason);
    left -= take;
  }
  if (left > 0) throw new UserError("Could not match the correction to whole output postings.");
  await c.query("update work_orders set completed_qty = completed_qty - $2 where id=$1", [woId, qty]);
  await audit(c, actor(x), "wo.correct_output", "work_order", woId, { qty }, reason);
}
export async function rescheduleOp(c: Db, x: Ctx, opId: string, start: string, end: string, reason: string) {
  if (!reason.trim()) throw new UserError("A reason is required to reschedule.");
  if (end < start) throw new UserError("End date cannot be before start date.");
  const op = (await c.query("select * from wo_operations where id=$1 for update", [opId])).rows[0];
  if (!op) throw new UserError("Operation not found.", "notfound");
  const prev = await c.query("select 1 from wo_operations where work_order_id=$1 and seq<$2 and planned_end >= $3 limit 1", [op.work_order_id, op.seq, start]);
  if (prev.rowCount) throw new UserError("Dependency conflict: an earlier operation is planned to finish on or after this start date.", "conflict");
  await c.query("insert into schedule_history(company_id,operation_id,old_start,old_end,new_start,new_end,reason,changed_by) values ($1,$2,$3,$4,$5,$6,$7,$8)", [x.companyId, opId, op.planned_start, op.planned_end, start, end, reason, x.userId]);
  await c.query("update wo_operations set planned_start=$2, planned_end=$3 where id=$1", [opId, start, end]);
  await audit(c, actor(x), "op.reschedule", "wo_operation", opId, { start, end }, reason);
  await notifyPerm(x.companyId, "shop.operate", "Operation rescheduled", "/app/schedule", `${start} → ${end}: ${reason}`, x.userId);
}
