"use server";
import { action, str, num } from "@/lib/server/action";
import { UserError } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { actor } from "@/lib/server/svc/ctx";
import { assertWithin } from "@/lib/server/billing";
import * as eng from "@/lib/server/svc/engineering";
import * as planning from "@/lib/server/svc/planning";
import * as proc from "@/lib/server/svc/procurement";
import * as prod from "@/lib/server/svc/production";
import * as qa from "@/lib/server/svc/quality";
import * as ful from "@/lib/server/svc/fulfilment";
import * as inv from "@/lib/server/svc/inventory";
import * as cost from "@/lib/server/svc/costing";
import { parseRupees } from "@/lib/domain/money";

const need = (fd: FormData, k: string, label: string) => { const v = str(fd, k); if (!v) throw new UserError(`${label} is required.`); return v; };
const qty = (fd: FormData, k: string, label: string) => { const v = num(fd, k); if (!Number.isFinite(v) || v <= 0) throw new UserError(`${label} must be a number greater than zero.`); return v; };
const nonneg = (fd: FormData, k: string, label: string, dflt = 0) => { if (str(fd, k) === "") return dflt; const v = num(fd, k); if (!Number.isFinite(v) || v < 0) throw new UserError(`${label} must be zero or more.`); return v; };
const money = (fd: FormData, k: string, label: string) => { try { return str(fd, k) ? parseRupees(str(fd, k)) : 0; } catch (e: any) { throw new UserError(`${label}: ${e.message}`); } };
const A = (c: any) => c;

// ---------- masters ----------
export const savePlant = action("master.write", async ({ fd, ctx, c }) => {
  await assertWithin(ctx.companyId, "plants");
  const r = await c.query("insert into plants(company_id,code,name) values ($1,$2,$3) returning id", [ctx.companyId, need(fd, "code", "Code").toUpperCase(), need(fd, "name", "Name")]);
  await audit(c, actor(ctx), "plant.create", "plant", r.rows[0].id); return "Plant added.";
});
export const saveLocation = action("master.write", async ({ fd, ctx, c }) => {
  await c.query("insert into locations(company_id,plant_id,code,name,kind) values ($1,$2,$3,$4,$5)", [ctx.companyId, need(fd, "plant", "Plant"), need(fd, "code", "Code").toUpperCase(), need(fd, "name", "Name"), str(fd, "kind") || "stock"]); return "Location added.";
});
export const saveWorkCentre = action("master.write", async ({ fd, ctx, c }) => {
  await c.query("insert into work_centres(company_id,plant_id,code,name,hours_per_day,cost_rate_per_hour_paise,overhead_pct) values ($1,$2,$3,$4,$5,$6,$7)",
    [ctx.companyId, need(fd, "plant", "Plant"), need(fd, "code", "Code").toUpperCase(), need(fd, "name", "Name"), qty(fd, "hours", "Hours per day"), money(fd, "rate", "Cost rate"), nonneg(fd, "overhead", "Overhead %")]); return "Work centre added.";
});
export const saveMachine = action("master.write", async ({ fd, ctx, c }) => {
  await c.query("insert into machines(company_id,work_centre_id,code,name,pm_interval_days) values ($1,$2,$3,$4,$5)", [ctx.companyId, need(fd, "wc", "Work centre"), need(fd, "code", "Code").toUpperCase(), need(fd, "name", "Name"), str(fd, "pm") ? Math.round(num(fd, "pm")) : null]); return "Machine added.";
});
export const saveShift = action("master.write", async ({ fd, ctx, c }) => {
  const plant = need(fd, "plant", "Plant");
  for (let d = 0; d < 7; d++) await c.query("insert into shift_calendar(company_id,plant_id,weekday,working) values ($1,$2,$3,$4) on conflict (company_id,plant_id,weekday) do update set working=excluded.working", [ctx.companyId, plant, d, fd.get("d" + d) === "on"]);
  return "Shift calendar saved. MRP lead times now skip non-working days.";
});
export const saveUom = action("master.write", async ({ fd, ctx, c }) => { await c.query("insert into uoms(company_id,code,name) values ($1,$2,$3)", [ctx.companyId, need(fd, "code", "Code").toUpperCase(), need(fd, "name", "Name")]); return "Unit added."; });
export const saveConversion = action("master.write", async ({ fd, ctx, c }) => {
  await c.query("insert into uom_conversions(company_id,item_id,from_uom,to_uom,factor) values ($1,$2,$3,$4,$5)", [ctx.companyId, str(fd, "item") || null, need(fd, "from", "From unit"), need(fd, "to", "To unit"), qty(fd, "factor", "Factor")]); return "Conversion approved.";
});
export const saveItem = action("master.write", async ({ fd, ctx, c }) => {
  const id = str(fd, "id");
  const kind = need(fd, "kind", "Type");
  if (!id) {
    await assertWithin(ctx.companyId, "items");
    const r = await c.query("insert into items(company_id,code,name,kind,uom,tracking,lot_size,lead_time_days,safety_stock,std_cost_paise) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
      [ctx.companyId, need(fd, "code", "Item code").toUpperCase(), need(fd, "name", "Name"), kind, need(fd, "uom", "Unit"), str(fd, "tracking") || "none", qty(fd, "lot", "Lot size"), Math.round(nonneg(fd, "lt", "Lead time")), nonneg(fd, "ss", "Safety stock"), money(fd, "std", "Standard cost")]);
    await c.query("insert into item_revisions(company_id,item_id,rev,approved_by) values ($1,$2,'A',$3)", [ctx.companyId, r.rows[0].id, ctx.userId]);
    await audit(c, actor(ctx), "item.create", "item", r.rows[0].id); return { redirect: "/app/items/" + r.rows[0].id };
  }
  const v = Number(str(fd, "version"));
  const r = await c.query("update items set name=$2, lead_time_days=$3, safety_stock=$4, lot_size=$5, std_cost_paise=$6, active=$7, version=version+1 where id=$1 and version=$8 returning id",
    [id, need(fd, "name", "Name"), Math.round(nonneg(fd, "lt", "Lead time")), nonneg(fd, "ss", "Safety stock"), qty(fd, "lot", "Lot size"), money(fd, "std", "Standard cost"), fd.get("active") === "on", v]);
  if (!r.rowCount) throw new UserError("Someone else changed this item while you were editing. Reload to see their changes.", "conflict");
  await audit(c, actor(ctx), "item.update", "item", id, { std: str(fd, "std") }); return "Item saved. Released jobs keep the values they were released with.";
});
export const reviseItem = action("eng.approve", async ({ fd, ctx, c }) => {
  const id = need(fd, "id", "Item"), rev = need(fd, "rev", "New revision").toUpperCase();
  await c.query("update item_revisions set status='obsolete' where item_id=$1 and status='approved'", [id]);
  await c.query("insert into item_revisions(company_id,item_id,rev,notes,approved_by) values ($1,$2,$3,$4,$5)", [ctx.companyId, id, rev, str(fd, "notes") || null, ctx.userId]);
  await c.query("update items set revision=$2 where id=$1", [id, rev]); await audit(c, actor(ctx), "item.revision", "item", id, { rev }, str(fd, "notes") || undefined); return `Revision ${rev} approved. Existing jobs stay on their released revision.`;
});
export const savePartner = action("master.write", async ({ fd, ctx, c }) => {
  const t = str(fd, "type") === "supplier" ? "suppliers" : "customers";
  await c.query(`insert into ${t}(company_id,code,name,email) values ($1,$2,$3,$4)`, [ctx.companyId, need(fd, "code", "Code").toUpperCase(), need(fd, "name", "Name"), str(fd, "email") || null]); return "Saved.";
});
export const addAlternate = action("master.write", async ({ fd, ctx, c }) => {
  await c.query("insert into item_alternates(company_id,item_id,alternate_item_id) values ($1,$2,$3)", [ctx.companyId, need(fd, "item", "Item"), need(fd, "alt", "Alternate")]); return "Approved alternate added.";
});
// ---------- engineering ----------
export const createBom = action("eng.write", async ({ fd, ctx, c }) => {
  const item = need(fd, "item", "Item");
  const v = (await c.query("select coalesce(max(version),0)+1 v from boms where item_id=$1", [item])).rows[0].v;
  const r = await c.query("insert into boms(company_id,item_id,version,yield_pct,effective_from) values ($1,$2,$3,$4,$5) returning id", [ctx.companyId, item, v, str(fd, "yield") ? qty(fd, "yield", "Yield") : 100, str(fd, "from") || new Date().toISOString().slice(0, 10)]);
  await audit(c, actor(ctx), "bom.create", "bom", r.rows[0].id); return { redirect: "/app/boms/" + r.rows[0].id };
});
export const addBomLine = action("eng.write", async ({ fd, ctx, c }) => {
  const sc = nonneg(fd, "scrap", "Scrap %"); if (sc >= 100) throw new UserError("Scrap % must be below 100.");
  await c.query("insert into bom_lines(company_id,bom_id,component_item_id,qty_per,scrap_pct,substitute_item_id) values ($1,$2,$3,$4,$5,$6)", [ctx.companyId, need(fd, "bom", "BOM"), need(fd, "comp", "Component"), qty(fd, "qty", "Quantity per"), sc, str(fd, "sub") || null]); return "Component added.";
});
export const removeBomLine = action("eng.write", async ({ fd, c }) => { await c.query("delete from bom_lines where id=$1", [need(fd, "id", "Line")]); return "Component removed."; });
export const submitBom = action("eng.write", async ({ fd, ctx, c }) => `Submitted as ${await eng.requestRelease(c, ctx, need(fd, "id", "BOM"), need(fd, "reason", "Reason for release"))} for approval.`);
export const decideChange = action("eng.approve", async ({ fd, ctx, c }) => { const ok = str(fd, "decision") === "approve"; await eng.decideChange(c, ctx, need(fd, "id", "Change"), ok, str(fd, "reason")); return ok ? "Approved — the new BOM is now effective." : "Rejected and returned to draft."; });
export const createRouting = action("eng.write", async ({ fd, ctx, c }) => {
  const item = need(fd, "item", "Item"); const v = (await c.query("select coalesce(max(version),0)+1 v from routings where item_id=$1", [item])).rows[0].v;
  const r = await c.query("insert into routings(company_id,item_id,version) values ($1,$2,$3) returning id", [ctx.companyId, item, v]); return { redirect: "/app/boms/routing/" + r.rows[0].id };
});
export const addRoutingOp = action("eng.write", async ({ fd, ctx, c }) => {
  await c.query("insert into routing_ops(company_id,routing_id,seq,name,work_centre_id,setup_min,run_min_per_unit,subcontract_supplier_id) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [ctx.companyId, need(fd, "routing", "Routing"), Math.round(qty(fd, "seq", "Sequence")), need(fd, "name", "Operation"), need(fd, "wc", "Work centre"), nonneg(fd, "setup", "Setup minutes"), nonneg(fd, "run", "Run minutes per unit"), str(fd, "supplier") || null]); return "Operation added.";
});
export const releaseRouting = action("eng.approve", async ({ fd, ctx, c }) => {
  const id = need(fd, "id", "Routing"); const r = (await c.query("select item_id from routings where id=$1", [id])).rows[0];
  const n = (await c.query("select count(*)::int n from routing_ops where routing_id=$1", [id])).rows[0].n; if (!n) throw new UserError("Add at least one operation first.");
  await c.query("update routings set status='obsolete' where item_id=$1 and status='released'", [r.item_id]); await c.query("update routings set status='released' where id=$1", [id]);
  await audit(c, actor(ctx), "routing.release", "routing", id); return "Routing released.";
});
// ---------- sales ----------
export const createOrder = action("sales.write", async ({ fd, ctx, c }) => {
  const cust = need(fd, "customer", "Customer"); const lines: { item: string; q: number; due: string; supply: string }[] = [];
  for (let i = 1; i <= 5; i++) { const it = str(fd, "item" + i); if (!it) continue; lines.push({ item: it, q: qty(fd, "qty" + i, `Line ${i} quantity`), due: need(fd, "due" + i, `Line ${i} due date`), supply: str(fd, "supply" + i) || "mto" }); }
  if (!lines.length) throw new UserError("Add at least one order line.");
  const n = (await c.query("select next_number($1,'so','SO') n", [ctx.companyId])).rows[0].n;
  const so = await c.query("insert into sales_orders(company_id,number,customer_id,created_by) values ($1,$2,$3,$4) returning id", [ctx.companyId, n, cust, ctx.userId]);
  let i = 0; for (const l of lines) await c.query("insert into sales_order_lines(company_id,order_id,line_no,item_id,qty,due_date,supply) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.companyId, so.rows[0].id, ++i, l.item, l.q, l.due, l.supply]);
  await audit(c, actor(ctx), "so.create", "sales_order", so.rows[0].id, { number: n }); return { redirect: "/app/sales/" + so.rows[0].id };
});
export const confirmOrder = action("sales.write", async ({ fd, ctx, c }) => {
  const id = need(fd, "id", "Order"); const r = await c.query("update sales_orders set status='confirmed', version=version+1 where id=$1 and status='draft' returning id", [id]);
  if (!r.rowCount) throw new UserError("Only draft orders can be confirmed.", "conflict");
  const lines = (await c.query("select * from sales_order_lines where order_id=$1", [id])).rows;
  const msgs: string[] = [];
  for (const l of lines) {
    // promise date reflects planning assumptions: due date, or +lead time if nothing is free in stock
    const free = (await inv.onHand(c, l.item_id, { availableOnly: true })) - (await inv.reservedQty(c, l.item_id));
    if (l.supply === "mts" && free >= Number(l.qty)) { await inv.reserve(c, ctx, l.item_id, Number(l.qty), "sales_order", l.id); msgs.push("stock reserved for line " + l.line_no); }
    const lt = (await c.query("select lead_time_days lt from items where id=$1", [l.item_id])).rows[0].lt;
    await c.query("update sales_order_lines set promised_date = (current_date + ($2 || ' days')::interval)::date where id=$1", [l.id, String(free >= Number(l.qty) ? 1 : lt + 7)]);
  }
  await audit(c, actor(ctx), "so.confirm", "sales_order", id); return "Order confirmed. Promise dates are planning estimates, not a capacity guarantee." + (msgs.length ? " " + msgs.join(", ") + "." : "");
});
export const cancelOrder = action("sales.write", async ({ fd, ctx, c }) => {
  const id = need(fd, "id", "Order"), reason = need(fd, "reason", "Cancellation reason");
  const shipped = (await c.query("select 1 from sales_order_lines where order_id=$1 and shipped_qty>0", [id])).rowCount; if (shipped) throw new UserError("Part of this order has already shipped; it cannot be cancelled.");
  await c.query("update sales_orders set status='cancelled', cancel_reason=$2 where id=$1 and status in ('draft','confirmed')", [id, reason]);
  const jobs = (await c.query("select w.number from work_orders w join sales_order_lines l on l.id=w.so_line_id where l.order_id=$1 and w.status in ('released','in_progress')", [id])).rows;
  await c.query("update reservations set status='released' where ref_type='sales_order' and ref_id in (select id from sales_order_lines where order_id=$1)", [id]);
  await audit(c, actor(ctx), "so.cancel", "sales_order", id, {}, reason); return "Order cancelled. Reservations released." + (jobs.length ? ` Review released jobs: ${jobs.map((j) => j.number).join(", ")}.` : "");
});
export const saveForecast = action("sales.write", async ({ fd, ctx, c }) => {
  const m = need(fd, "month", "Month") + "-01";
  await c.query("insert into forecasts(company_id,item_id,period_start,qty) values ($1,$2,$3,$4) on conflict (item_id,period_start) do update set qty=excluded.qty", [ctx.companyId, need(fd, "item", "Item"), m, nonneg(fd, "qty", "Quantity")]); return "Forecast saved. It is netted against confirmed orders, never added to them.";
});
export const createQuote = action("sales.write", async ({ fd, ctx, c }) => {
  const item = need(fd, "item", "Item"), q = qty(fd, "qty", "Quantity"), margin = nonneg(fd, "margin", "Margin %", 20);
  const std = Number((await c.query("select std_cost_paise s from items where id=$1", [item])).rows[0].s);
  const est = Math.round(std * q), price = Math.round(est * (1 + margin / 100)), n = (await c.query("select next_number($1,'qt','QT') n", [ctx.companyId])).rows[0].n;
  await c.query("insert into quotations(company_id,number,customer_id,item_id,qty,est_cost_paise,margin_pct,quoted_price_paise) values ($1,$2,$3,$4,$5,$6,$7,$8)", [ctx.companyId, n, need(fd, "customer", "Customer"), item, q, est, margin, price]);
  return `Quotation ${n} created from the standard-cost estimate. Estimates stay separate from actual job cost.`;
});
// ---------- planning ----------
export const runMrpAction = action("plan.run", async ({ fd, ctx, c }) => { const r = await planning.runPlanning(c, ctx, Math.round(qty(fd, "horizon", "Horizon (days)"))); return { redirect: "/app/planning/" + r.id }; });
export const releaseSuggestionAction = action("plan.release", async ({ fd, ctx, c }) => {
  const ref = await planning.releaseSuggestion(c, ctx, need(fd, "id", "Suggestion"), { supplierId: str(fd, "supplier") || undefined, plantId: str(fd, "plant") || undefined, price: money(fd, "price", "Price") });
  return `Released as ${ref}. It is a draft order — it still needs the normal approval.`;
});
export const dismissSuggestionAction = action("plan.release", async ({ fd, ctx, c }) => { await planning.dismissSuggestion(c, ctx, need(fd, "id", "Suggestion"), str(fd, "reason")); return "Dismissed."; });
export const rescheduleAction = action("prod.write", async ({ fd, ctx, c }) => { await prod.rescheduleOp(c, ctx, need(fd, "id", "Operation"), need(fd, "start", "Start"), need(fd, "end", "End"), str(fd, "reason")); return "Rescheduled. The previous dates are kept in the schedule history."; });
// ---------- procurement ----------
export const createPoAction = action("proc.write", async ({ fd, ctx, c }) => {
  const lines = []; for (let i = 1; i <= 5; i++) { const it = str(fd, "item" + i); if (!it) continue; lines.push({ itemId: it, qty: qty(fd, "qty" + i, `Line ${i} quantity`), price: money(fd, "price" + i, `Line ${i} price`), dueDate: need(fd, "due" + i, `Line ${i} due date`) }); }
  const po = await proc.createPO(c, ctx, need(fd, "supplier", "Supplier"), lines); return { redirect: "/app/purchasing/" + po.id };
});
export const poWorkflow = action("proc.write", async ({ fd, ctx, c }) => {
  const id = need(fd, "id", "PO"), op = str(fd, "op");
  if (op === "submit") { await proc.submitPO(c, ctx, id); return "Submitted for approval."; }
  const { can } = await import("@/lib/server/perms"); if (!can(ctx.role, "proc.approve")) throw new UserError("You are not allowed to approve purchase orders.", "denied");
  await proc.decidePO(c, ctx, id, op === "approve", str(fd, "reason")); return op === "approve" ? "Approved." : "Rejected and returned to draft.";
});
export const receivePoAction = action("inv.post", async ({ fd, ctx, c }) => {
  const po = need(fd, "po", "PO"); const lines = (await c.query("select id from purchase_order_lines where po_id=$1", [po])).rows
    .map((l) => ({ lineId: l.id, qty: Number(str(fd, "q_" + l.id) || 0), batchCode: str(fd, "b_" + l.id) || undefined })).filter((l) => l.qty > 0);
  const key = str(fd, "key") || undefined; const n = await proc.receive(c, ctx, po, lines, str(fd, "invoice"), need(fd, "loc", "Location"), key); return `Receipt ${n} posted. Tracked items are in quarantine until inspected.`;
});
export const sendSubAction = action("proc.write", async ({ fd, ctx, c }) => `Sent as ${await proc.sendSubcontract(c, ctx, { supplierId: need(fd, "supplier", "Supplier"), itemId: need(fd, "item", "Item"), qty: qty(fd, "qty", "Quantity"), woId: str(fd, "wo") || undefined, expectedReturn: need(fd, "ret", "Expected return"), locationId: need(fd, "loc", "From location") })}. Company-owned material is tracked until it returns.`);
export const receiveSubAction = action("inv.post", async ({ fd, ctx, c }) => { await proc.receiveSubcontract(c, ctx, need(fd, "id", "Order"), nonneg(fd, "good", "Received"), nonneg(fd, "lost", "Lost / scrapped"), need(fd, "loc", "Location"), null); return "Reconciled."; });
// ---------- inventory ----------
export const transferAction = action("inv.post", async ({ fd, ctx, c }) => { await inv.transfer(c, ctx, need(fd, "item", "Item"), str(fd, "batch") || null, need(fd, "from", "From"), need(fd, "to", "To"), qty(fd, "qty", "Quantity"), str(fd, "key") || undefined); return "Transferred."; });
export const adjustAction = action("inv.adjust", async ({ fd, ctx, c }) => { const r = await inv.adjust(c, ctx, need(fd, "item", "Item"), str(fd, "batch") || null, need(fd, "loc", "Location"), nonneg(fd, "counted", "Counted quantity"), str(fd, "reason")); return r.diff === 0 ? "Count matches the system — nothing to adjust." : `Adjustment of ${r.diff > 0 ? "+" : ""}${r.diff} posted.`; });
export const reverseAction = action("inv.adjust", async ({ fd, ctx, c }) => { await inv.reverse(c, ctx, need(fd, "id", "Movement"), str(fd, "reason")); return "Reversal posted; the original stays in the ledger."; });
export const openingStock = action("inv.adjust", async ({ fd, ctx, c }) => {
  const item = need(fd, "item", "Item"); const q = qty(fd, "qty", "Quantity"); const unit = money(fd, "cost", "Unit cost");
  const tr = (await c.query("select tracking from items where id=$1", [item])).rows[0].tracking; let batch: string | null = null;
  if (tr !== "none") { const code = need(fd, "batch", "Batch code"); batch = (await c.query("insert into batches(company_id,item_id,code,source_ref) values ($1,$2,$3,'opening') on conflict (company_id,item_id,code) do update set code=excluded.code returning id", [ctx.companyId, item, code])).rows[0].id; }
  await inv.post(c, ctx, { itemId: item, batchId: batch, locationId: need(fd, "loc", "Location"), qty: q, kind: "adjust", note: "Opening stock", unitCostPaise: unit, key: str(fd, "key") || undefined });
  await audit(c, actor(ctx), "stock.opening", "item", item, { qty: q }, "Opening stock"); return "Opening stock posted."; });
// ---------- production ----------
export const createWoAction = action("prod.write", async ({ fd, ctx, c }) => { const w = await prod.createWO(c, ctx, { itemId: need(fd, "item", "Item"), qty: qty(fd, "qty", "Quantity"), dueDate: need(fd, "due", "Due date"), plantId: need(fd, "plant", "Plant") }); return { redirect: "/app/production/" + w.id }; });
export const releaseWoAction = action("prod.write", async ({ fd, ctx, c }) => { await prod.releaseWO(c, ctx, need(fd, "id", "Work order")); return "Released. The BOM and routing are now frozen for this job."; });
export const issueAction = action("shop.operate", async ({ fd, ctx, c }) => { const r = await prod.issueMaterial(c, ctx, need(fd, "wo", "Work order"), need(fd, "item", "Item"), qty(fd, "qty", "Quantity"), str(fd, "batch") || null, need(fd, "loc", "Location"), str(fd, "override") || undefined, str(fd, "key") || undefined); return "duplicate" in r ? "Already posted — duplicate submission ignored." : "Material issued and posted to the ledger."; });
export const opAct = action("shop.operate", async ({ fd, ctx, c }) => { const a = str(fd, "op") as "start" | "pause" | "finish"; await prod.opAction(c, ctx, need(fd, "id", "Operation"), a); return { start: "Started.", pause: "Paused.", finish: "Operation finished." }[a]; });
export const outputAction = action("shop.operate", async ({ fd, ctx, c }) => {
  const serials = str(fd, "serials").split(/[\s,]+/).filter(Boolean);
  const r = await prod.reportOutput(c, ctx, need(fd, "wo", "Work order"), nonneg(fd, "good", "Good quantity"), nonneg(fd, "scrap", "Scrap quantity"), str(fd, "batch"), serials, need(fd, "loc", "Location"), str(fd, "key") || undefined);
  return "duplicate" in r ? "Already posted." : "Output posted. Tracked output is in quarantine until the final inspection passes."; });
export const completeWoAction = action("prod.write", async ({ fd, ctx, c }) => { await prod.completeWO(c, ctx, need(fd, "id", "Work order"), str(fd, "reason")); return "Work order completed."; });
export const reworkAction = action("prod.write", async ({ fd, ctx, c }) => { const r = await prod.createRework(c, ctx, need(fd, "id", "Work order"), qty(fd, "qty", "Quantity"), str(fd, "reason")); return { redirect: "/app/production/" + r.id }; });
export const correctOutputAction = action("prod.write", async ({ fd, ctx, c }) => { await prod.correctOutput(c, ctx, need(fd, "id", "Work order"), qty(fd, "qty", "Quantity"), str(fd, "reason")); return "Output corrected with a reversing movement."; });
export const downtimeAction = action("shop.operate", async ({ fd, ctx, c }) => { await c.query("insert into downtime(company_id,work_centre_id,machine_id,minutes,reason,reported_by) values ($1,$2,$3,$4,$5,$6)", [ctx.companyId, need(fd, "wc", "Work centre"), str(fd, "machine") || null, Math.round(qty(fd, "min", "Minutes")), need(fd, "reason", "Reason"), ctx.userId]); return "Downtime recorded."; });
export const maintenanceAction = action("shop.operate", async ({ fd, ctx, c }) => {
  if (str(fd, "close")) { await c.query("update maintenance_requests set status='done', closed_at=now() where id=$1", [str(fd, "close")]); await c.query("update machines set last_pm_at=current_date where id=(select machine_id from maintenance_requests where id=$1)", [str(fd, "close")]); return "Closed."; }
  await c.query("insert into maintenance_requests(company_id,machine_id,description,requested_by) values ($1,$2,$3,$4)", [ctx.companyId, need(fd, "machine", "Machine"), need(fd, "desc", "Description"), ctx.userId]); return "Maintenance request raised."; });
// ---------- quality ----------
export const inspectAction = action("qa.decide", async ({ fd, ctx, c }) => {
  const m = str(fd, "measured") ? num(fd, "measured") : null; if (m !== null && !Number.isFinite(m)) throw new UserError("Measured value must be a number.");
  const lim = (k: string) => (str(fd, k) ? num(fd, k) : null);
  const pass = await qa.recordResult(c, ctx, need(fd, "id", "Inspection"), { measured: m, min: lim("min"), max: lim("max"), unit: str(fd, "unit"), pass: str(fd, "result") === "pass", notes: str(fd, "notes") });
  return pass ? "Passed — the batch is released to stock." : "Failed — batch stays in quarantine and an NCR was raised."; });
export const raiseInspectionAction = action("qa.write", async ({ fd, ctx, c }) => { await qa.raiseInspection(c, ctx, { kind: (str(fd, "kind") || "in_process") as any, itemId: need(fd, "item", "Item"), batchId: str(fd, "batch") || null, qty: qty(fd, "qty", "Quantity") }); return "Inspection raised."; });
export const dispositionAction = action("qa.decide", async ({ fd, ctx, c }) => { await qa.disposition(c, ctx, need(fd, "id", "NCR"), need(fd, "disp", "Disposition") as any, str(fd, "reason"), str(fd, "action")); return "Disposition recorded."; });
// ---------- fulfilment ----------
export const createShipmentAction = action("ship.write", async ({ fd, ctx, c }) => {
  const line = (await c.query("select l.id, o.customer_id from sales_order_lines l join sales_orders o on o.id=l.order_id where l.id=$1", [need(fd, "line", "Order line")])).rows[0];
  const s = await ful.createShipment(c, ctx, line.customer_id, [{ soLineId: line.id, batchId: str(fd, "batch") || null, locationId: need(fd, "loc", "Location"), qty: qty(fd, "qty", "Quantity"), serials: str(fd, "serials").split(/[\s,]+/).filter(Boolean) }]); return { redirect: "/app/shipping/" + s.id };
});
export const dispatchAction = action("ship.write", async ({ fd, ctx, c }) => { await ful.dispatch(c, ctx, need(fd, "id", "Shipment"), str(fd, "invoice")); return "Dispatched. Stock reduced and order quantities updated."; });
export const deliverAction = action("ship.write", async ({ fd, ctx, c }) => { await ful.confirmDelivery(c, ctx, need(fd, "id", "Shipment"), str(fd, "note")); return "Delivery confirmed."; });
export const returnAction = action("ship.write", async ({ fd, ctx, c }) => `Return ${await ful.createReturn(c, ctx, need(fd, "ship", "Shipment"), need(fd, "item", "Item"), qty(fd, "qty", "Quantity"), str(fd, "reason"))} logged — it must be inspected before restocking.`);
export const returnDispositionAction = action("qa.decide", async ({ fd, ctx, c }) => { await ful.dispositionReturn(c, ctx, need(fd, "id", "Return"), str(fd, "result") === "restock", need(fd, "loc", "Location"), str(fd, "reason")); return "Return dispositioned."; });
// ---------- costing ----------
export const costAdjustAction = action("cost.adjust", async ({ fd, ctx, c }) => { await cost.adjustCost(c, ctx, need(fd, "id", "Job"), money(fd, "amount", "Amount") * (str(fd, "dir") === "credit" ? -1 : 1), str(fd, "reason")); return "Correction posted to the current open period."; });
export const closePeriodAction = action("cost.adjust", async ({ fd, ctx, c }) => { await cost.closePeriod(c, ctx, need(fd, "period", "Period")); return "Period closed. Later corrections post to the next open period."; });
void A;
