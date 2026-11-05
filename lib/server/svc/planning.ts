import "server-only";
import crypto from "node:crypto";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import { loadBoms } from "./engineering";
import * as inv from "./inventory";
import * as proc from "./procurement";
import * as prod from "./production";
import { runMrp, type DemandLine, type Supply } from "@/lib/domain/mrp";
import { componentQty } from "@/lib/domain/bom";
import { iso } from "@/lib/domain/dates";

async function gather(c: Db, today: string, boms: Awaited<ReturnType<typeof loadBoms>>) {
  const items = (await c.query("select id, code, kind, lead_time_days, lot_size, safety_stock from items where active")).rows;
  const hand = new Map<string, number>();
  for (const r of (await c.query(`select b.item_id, sum(b.qty) q from stock_balances b join locations l on l.id=b.location_id left join batches ba on ba.id=b.batch_id
      where l.kind='stock' and (ba.id is null or ba.status='available') group by 1`)).rows) hand.set(r.item_id, Number(r.q));
  const res = new Map<string, number>();
  for (const r of (await c.query("select item_id, sum(qty) q from reservations where status='active' group by 1")).rows) res.set(r.item_id, Number(r.q));
  const demand: DemandLine[] = (await c.query(`select l.item_id item, (l.qty-l.shipped_qty) qty, l.due_date::text date, o.number||'/'||l.line_no source from sales_order_lines l join sales_orders o on o.id=l.order_id
     where o.status='confirmed' and l.shipped_qty < l.qty`)).rows.map((r) => ({ ...r, qty: Number(r.qty) }));
  // Existing jobs also consume components: released jobs need what is not yet issued or reserved; planned jobs need their full BOM.
  for (const r of (await c.query(`select m.item_id item, greatest(0, m.planned_qty - m.issued_qty - coalesce((select sum(qty) from reservations r where r.ref_id=m.work_order_id and r.item_id=m.item_id and r.status='active'),0)) qty,
      $1::text date, w.number source from wo_materials m join work_orders w on w.id=m.work_order_id where w.status in ('released','in_progress')`, [today])).rows)
    if (Number(r.qty) > 0) demand.push({ item: r.item, qty: Number(r.qty), date: r.date, source: `${r.source} (open material)` });
  for (const w of (await c.query("select number, item_id, qty, due_date::text due from work_orders where status='planned'")).rows) {
    const b = boms.get(w.item_id); if (!b) continue;
    for (const l of b.lines) demand.push({ item: l.component, qty: componentQty(Number(w.qty), l, b.yieldPct), date: w.due < today ? today : w.due, source: `${w.number} (planned job)` });
  }
  const forecasts = (await c.query("select item_id item, period_start::text \"periodStart\", qty from forecasts where period_start >= date_trunc('month', $1::date)", [today])).rows.map((r) => ({ ...r, qty: Number(r.qty) }));
  const supplies: Supply[] = [
    ...(await c.query(`select l.item_id item, (l.qty-l.received_qty) qty, l.due_date::text date, p.number source from purchase_order_lines l join purchase_orders p on p.id=l.po_id where p.status in ('approved','partial') and l.received_qty<l.qty`)).rows,
    ...(await c.query(`select w.item_id item, (w.qty-w.completed_qty) qty, w.due_date::text date, w.number source from work_orders w where w.status in ('planned','released','in_progress') and w.completed_qty<w.qty`)).rows,
  ].map((r) => ({ ...r, qty: Number(r.qty) }));
  const wk = (await c.query("select distinct weekday from shift_calendar where working")).rows.map((r) => r.weekday as number);
  return { items, hand, res, demand, forecasts, supplies, wk: wk.length ? wk : [1, 2, 3, 4, 5], demandHash: crypto.createHash("sha256").update(JSON.stringify([demand, forecasts])).digest("hex") };
}
export async function demandHash(c: Db) { const t = iso(new Date()); return (await gather(c, t, await loadBoms(c, t))).demandHash; }

export async function runPlanning(c: Db, x: Ctx, horizonDays = 90, today = iso(new Date())) {
  if (horizonDays < 1 || horizonDays > 365) throw new UserError("Horizon must be between 1 and 365 days.");
  const boms = await loadBoms(c, today);
  const g = await gather(c, today, boms);
  const res = runMrp({
    today, horizonDays, salesDemand: g.demand, forecasts: g.forecasts, supplies: g.supplies, workingWeekdays: g.wk,
    getBom: (i) => boms.get(i),
    items: g.items.map((i) => ({ id: i.id, code: i.code, kind: i.kind, leadTimeDays: i.lead_time_days, lotSize: Number(i.lot_size), safetyStock: Number(i.safety_stock), onHand: (g.hand.get(i.id) ?? 0) - (g.res.get(i.id) ?? 0) })),
  });
  const num = (await c.query("select next_number($1,'mrp','MRP') n", [x.companyId])).rows[0].n;
  const params = { horizonDays, today, capacity: "infinite", assumptions: res.assumptions, demandHash: g.demandHash };
  const snapshot = { demand: g.demand, forecasts: g.forecasts, supplies: g.supplies, onHand: [...g.hand], reserved: [...g.res] };
  const run = await c.query("insert into mrp_runs(company_id,number,params,snapshot,created_by) values ($1,$2,$3,$4,$5) returning id", [x.companyId, num, JSON.stringify(params), JSON.stringify(snapshot), x.userId]);
  for (const s of res.suggestions) await c.query("insert into mrp_suggestions(company_id,run_id,item_id,kind,qty,need_date,release_date,reason) values ($1,$2,$3,$4,$5,$6,$7,$8)", [x.companyId, run.rows[0].id, s.item, s.kind, s.qty, s.needDate, s.releaseDate, JSON.stringify(s.reason)]);
  await audit(c, actor(x), "mrp.run", "mrp_run", run.rows[0].id, { number: num, suggestions: res.suggestions.length });
  return { id: run.rows[0].id as string, number: num as string, count: res.suggestions.length };
}
/** Deliberate release: converts a suggestion into a real order, only if demand is unchanged since the run. */
export async function releaseSuggestion(c: Db, x: Ctx, sugId: string, a: { supplierId?: string; plantId?: string; price?: number }) {
  const s = (await c.query("select s.*, r.params from mrp_suggestions s join mrp_runs r on r.id=s.run_id where s.id=$1 for update of s", [sugId])).rows[0];
  if (!s) throw new UserError("Suggestion not found.", "notfound");
  if (s.status !== "suggested") throw new UserError(`This suggestion is already ${s.status}.`, "conflict");
  if (s.params.demandHash !== (await demandHash(c))) throw new UserError("Demand has changed since this planning run. Run planning again before releasing.", "conflict");
  let ref: string;
  if (s.kind === "purchase") {
    if (!a.supplierId) throw new UserError("Choose a supplier to raise the purchase order.");
    const po = await proc.createPO(c, x, a.supplierId, [{ itemId: s.item_id, qty: Number(s.qty), price: a.price ?? 0, dueDate: s.need_date, suggestionId: s.id }]);
    ref = po.number;
  } else {
    if (!a.plantId) throw new UserError("Choose a plant for the work order.");
    const wo = await prod.createWO(c, x, { itemId: s.item_id, qty: Number(s.qty), dueDate: s.need_date, plantId: a.plantId, suggestionId: s.id });
    ref = wo.number;
  }
  await c.query("update mrp_suggestions set status='released', released_ref=$2, decided_by=$3 where id=$1", [sugId, ref, x.userId]);
  await audit(c, actor(x), "mrp.release", "mrp_suggestion", sugId, { ref });
  return ref;
}
export async function dismissSuggestion(c: Db, x: Ctx, sugId: string, reason: string) {
  if (!reason.trim()) throw new UserError("A reason is required to dismiss a suggestion.");
  const r = await c.query("update mrp_suggestions set status='dismissed', decided_by=$2 where id=$1 and status='suggested' returning id", [sugId, x.userId]);
  if (!r.rowCount) throw new UserError("Suggestion is no longer open.", "conflict");
  await audit(c, actor(x), "mrp.dismiss", "mrp_suggestion", sugId, {}, reason);
}
/** Shortage preview for a prospective order line: what can be committed from stock vs needs planning. */
export async function shortagePreview(c: Db, itemId: string, qty: number) {
  const free = (await inv.onHand(c, itemId, { availableOnly: true })) - (await inv.reservedQty(c, itemId));
  return { free, short: Math.max(0, qty - Math.max(free, 0)) };
}
