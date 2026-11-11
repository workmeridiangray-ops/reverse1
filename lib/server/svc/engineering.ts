import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import type { BomDef } from "@/lib/domain/bom";
import { notifyPerm } from "../notify";

/** Effective released BOMs at a date, as pure BomDef objects keyed by item id. */
export async function loadBoms(c: Db, onDate: string): Promise<Map<string, BomDef & { bomId: string; version: number }>> {
  const r = await c.query(`select distinct on (b.item_id) b.id, b.item_id, b.version, b.yield_pct from boms b
     where b.status='released' and b.effective_from <= $1 and (b.effective_to is null or b.effective_to >= $1) order by b.item_id, b.version desc`, [onDate]);
  const lines = await c.query("select bom_id, component_item_id, qty_per, scrap_pct from bom_lines where bom_id = any($1::uuid[])", [r.rows.map((b) => b.id)]);
  const m = new Map<string, BomDef & { bomId: string; version: number }>();
  for (const b of r.rows) m.set(b.item_id, { item: b.item_id, bomId: b.id, version: b.version, yieldPct: Number(b.yield_pct),
    lines: lines.rows.filter((l) => l.bom_id === b.id).map((l) => ({ component: l.component_item_id, qtyPer: Number(l.qty_per), scrapPct: Number(l.scrap_pct) })) });
  return m;
}
/** Open work orders that were released on a BOM version that would be superseded. */
export async function affectedJobs(c: Db, bomId: string) {
  const b = (await c.query("select item_id from boms where id=$1", [bomId])).rows[0];
  const r = await c.query(`select w.id, w.number, w.status, w.qty, i.code from work_orders w join items i on i.id=w.item_id
    where w.status in ('planned','released','in_progress') and (w.bom_snapshot->>'itemId' = $1 or exists (
      select 1 from jsonb_array_elements(coalesce(w.bom_snapshot->'lines','[]')) l where l->>'component' = $1))`, [b.item_id]);
  return r.rows;
}
export async function requestRelease(c: Db, x: Ctx, bomId: string, reason: string) {
  const b = (await c.query("select status from boms where id=$1", [bomId])).rows[0];
  if (!b) throw new UserError("BOM not found.", "notfound");
  if (b.status !== "draft") throw new UserError("Only a draft BOM can be submitted for approval.");
  const n = (await c.query("select count(*) from bom_lines where bom_id=$1", [bomId])).rows[0].count;
  if (Number(n) === 0) throw new UserError("Add at least one component before submitting.");
  const affected = await affectedJobs(c, bomId);
  const num = (await c.query("select next_number($1,'ecr','ECR') n", [x.companyId])).rows[0].n;
  await c.query("update boms set status='pending' where id=$1", [bomId]);
  await c.query("insert into change_requests(company_id,number,bom_id,reason,affected,requested_by) values ($1,$2,$3,$4,$5,$6)", [x.companyId, num, bomId, reason, JSON.stringify(affected), x.userId]);
  await audit(c, actor(x), "eco.request", "bom", bomId, { number: num, affectedJobs: affected.length }, reason);
  await notifyPerm(x.companyId, "eng.approve", `Engineering change ${num} awaiting approval`, "/app/changes", `${affected.length} open job(s) affected`, x.userId);
  return num;
}
export async function decideChange(c: Db, x: Ctx, crId: string, approve: boolean, reason: string) {
  if (!approve && !reason.trim()) throw new UserError("A reason is required when rejecting a change.");
  const cr = (await c.query("select * from change_requests where id=$1 for update", [crId])).rows[0];
  if (!cr || cr.status !== "pending") throw new UserError("This change request is no longer pending.", "conflict");
  if (cr.requested_by === x.userId) throw new UserError("You cannot approve your own change request.", "denied");
  await c.query("update change_requests set status=$2, decided_by=$3, decision_reason=$4, decided_at=now() where id=$1", [crId, approve ? "approved" : "rejected", x.userId, reason || null]);
  if (approve) {
    const b = (await c.query("select item_id from boms where id=$1", [cr.bom_id])).rows[0];
    await c.query("update boms set status='obsolete', effective_to=current_date - 1 where item_id=$1 and status='released'", [b.item_id]);
    await c.query("update boms set status='released', effective_from=current_date where id=$1", [cr.bom_id]);
  } else await c.query("update boms set status='draft' where id=$1", [cr.bom_id]);
  await audit(c, actor(x), approve ? "eco.approve" : "eco.reject", "bom", cr.bom_id, { number: cr.number }, reason);
}
