import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import { jobCost } from "@/lib/domain/cost";
import { can } from "../perms";

export async function jobCostFor(c: Db, woId: string) {
  const wo = (await c.query("select w.*, i.std_cost_paise from work_orders w join items i on i.id=w.item_id where w.id=$1", [woId])).rows[0];
  if (!wo) throw new UserError("Work order not found.", "notfound");
  const mats = (await c.query("select qty, unit_cost_paise from stock_movements where ref_type='work_order' and ref_id=$1 and kind='issue'", [woId])).rows;
  const revs = (await c.query("select qty, unit_cost_paise from stock_movements where kind='reversal' and reverses_id in (select id from stock_movements where ref_type='work_order' and ref_id=$1 and kind='issue')", [woId])).rows;
  const ops = (await c.query("select o.actual_min, w.cost_rate_per_hour_paise rate, w.overhead_pct oh from wo_operations o join work_centres w on w.id=o.work_centre_id where o.work_order_id=$1", [woId])).rows;
  const adj = (await c.query("select coalesce(sum(amount_paise),0) a from cost_adjustments where work_order_id=$1", [woId])).rows[0].a;
  const cost = jobCost({
    materialIssued: [...mats.map((m) => ({ qty: -Number(m.qty), unitCostPaise: Number(m.unit_cost_paise) })), ...revs.map((m) => ({ qty: -Number(m.qty), unitCostPaise: Number(m.unit_cost_paise) }))],
    ops: ops.map((o) => ({ actualMin: Number(o.actual_min), rateHourPaise: Number(o.rate), overheadPct: Number(o.oh) })),
    completedQty: Number(wo.completed_qty), scrapQty: Number(wo.scrap_qty), standardUnitPaise: Number(wo.std_cost_paise),
  });
  return { ...cost, adjustments: Number(adj), totalWithAdjustments: cost.total + Number(adj), wo };
}
export async function periodStatus(c: Db, period: string) {
  return (await c.query("select status from cost_periods where period=$1", [period])).rows[0]?.status ?? "open";
}
/** Corrections after a period closes post to the current open period; closed history is never rewritten. */
export async function adjustCost(c: Db, x: Ctx, woId: string, amountPaise: number, reason: string) {
  if (!can(x.role, "cost.adjust")) throw new UserError("You are not allowed to correct costs.", "denied");
  if (!reason.trim()) throw new UserError("A reason is required for a cost correction.");
  if (!Number.isInteger(amountPaise) || amountPaise === 0) throw new UserError("Enter a non-zero amount.");
  const period = new Date().toISOString().slice(0, 7);
  if ((await periodStatus(c, period)) === "closed") throw new UserError(`Period ${period} is closed. Reopen is not allowed; ask finance to post into the next open period.`, "closed");
  await c.query("insert into cost_adjustments(company_id,work_order_id,amount_paise,reason,period,by_user) values ($1,$2,$3,$4,$5,$6)", [x.companyId, woId, amountPaise, reason, period, x.userId]);
  await audit(c, actor(x), "cost.adjust", "work_order", woId, { amountPaise, period }, reason);
}
export async function closePeriod(c: Db, x: Ctx, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new UserError("Period must look like 2026-11.");
  const open = await c.query("select number from work_orders where status in ('released','in_progress') and to_char(created_at,'YYYY-MM') <= $1 limit 3", [period]);
  if (open.rowCount) throw new UserError(`Open jobs remain from this period (${open.rows.map((r) => r.number).join(", ")}). Complete or cancel them before closing.`, "conflict");
  await c.query("insert into cost_periods(company_id,period,status,closed_by,closed_at) values ($1,$2,'closed',$3,now()) on conflict (company_id,period) do update set status='closed', closed_by=$3, closed_at=now()", [x.companyId, period, x.userId]);
  await audit(c, actor(x), "period.close", "cost_period", period);
}
export async function accountingExportRows(c: Db) {
  const wos = (await c.query("select id, number from work_orders where status in ('completed','closed') order by number")).rows;
  const out: string[][] = [["job", "item", "completed_qty", "material_paise", "labour_paise", "overhead_paise", "adjustments_paise", "total_paise", "standard_paise", "variance_paise"]];
  for (const w of wos) { const j = await jobCostFor(c, w.id); out.push([w.number, String(j.wo.item_id), String(j.wo.completed_qty), String(j.material), String(j.labour), String(j.overhead), String(j.adjustments), String(j.totalWithAdjustments), String(j.standardTotal), String(j.variance)]); }
  return out;
}
