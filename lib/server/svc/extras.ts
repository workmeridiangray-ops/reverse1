import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { notifyPerm } from "../notify";
import { type Ctx, actor } from "./ctx";
import * as inv from "./inventory";
import * as proc from "./procurement";
import { can } from "../perms";

// ---------- purchase requests, RFQ, comparison, award ----------
export async function createPR(c: Db, x: Ctx, itemId: string, qty: number, neededBy: string, reason: string) {
  if (!(qty > 0)) throw new UserError("Quantity must be greater than zero.");
  const it = (await c.query("select kind from items where id=$1", [itemId])).rows[0];
  if (!it) throw new UserError("Item not found.", "notfound");
  if (it.kind === "make") throw new UserError("Manufactured items are made on a work order, not purchased.");
  const n = (await c.query("select next_number($1,'pr','PR') n", [x.companyId])).rows[0].n;
  const r = await c.query("insert into purchase_requests(company_id,number,item_id,qty,needed_by,reason,requested_by) values ($1,$2,$3,$4,$5,$6,$7) returning id", [x.companyId, n, itemId, qty, neededBy, reason || null, x.userId]);
  await audit(c, actor(x), "pr.create", "purchase_request", r.rows[0].id, { number: n });
  await notifyPerm(x.companyId, "proc.write", `Purchase request ${n} raised`, "/app/purchasing/requests", undefined, x.userId);
  return n as string;
}
export async function openRfq(c: Db, x: Ctx, prId: string) {
  const pr = (await c.query("select * from purchase_requests where id=$1 for update", [prId])).rows[0];
  if (!pr || pr.status !== "open") throw new UserError("Only open requests can go to RFQ.", "conflict");
  const n = (await c.query("select next_number($1,'rfq','RFQ') n", [x.companyId])).rows[0].n;
  const r = await c.query("insert into rfqs(company_id,number,pr_id,created_by) values ($1,$2,$3,$4) returning id", [x.companyId, n, prId, x.userId]);
  await c.query("update purchase_requests set status='rfq' where id=$1", [prId]);
  await audit(c, actor(x), "rfq.open", "rfq", r.rows[0].id, { number: n }); return r.rows[0].id as string;
}
export async function addQuote(c: Db, x: Ctx, rfqId: string, supplierId: string, pricePaise: number, leadDays: number, note: string) {
  const r = (await c.query("select status from rfqs where id=$1", [rfqId])).rows[0];
  if (!r || r.status !== "open") throw new UserError("This RFQ is closed.", "conflict");
  if (pricePaise < 0 || leadDays < 0) throw new UserError("Price and lead time cannot be negative.");
  await c.query("insert into rfq_quotes(company_id,rfq_id,supplier_id,unit_price_paise,lead_days,note) values ($1,$2,$3,$4,$5,$6) on conflict (rfq_id,supplier_id) do update set unit_price_paise=excluded.unit_price_paise, lead_days=excluded.lead_days, note=excluded.note", [x.companyId, rfqId, supplierId, pricePaise, leadDays, note || null]);
}
/** Award creates a DRAFT purchase order for the chosen quote; the PO still needs normal maker-checker approval. */
export async function awardRfq(c: Db, x: Ctx, rfqId: string, quoteId: string) {
  const rfq = (await c.query("select r.*, p.item_id, p.qty, p.needed_by from rfqs r join purchase_requests p on p.id=r.pr_id where r.id=$1 for update of r", [rfqId])).rows[0];
  if (!rfq || rfq.status !== "open") throw new UserError("This RFQ is already closed.", "conflict");
  const q = (await c.query("select * from rfq_quotes where id=$1 and rfq_id=$2", [quoteId, rfqId])).rows[0];
  if (!q) throw new UserError("Quote not found on this RFQ.");
  const po = await proc.createPO(c, x, q.supplier_id, [{ itemId: rfq.item_id, qty: Number(rfq.qty), price: Number(q.unit_price_paise), dueDate: rfq.needed_by }]);
  await c.query("update rfqs set status='awarded', awarded_quote_id=$2 where id=$1", [rfqId, quoteId]);
  await c.query("update purchase_requests set status='converted', po_id=$2 where id=$1", [rfq.pr_id, po.id]);
  await audit(c, actor(x), "rfq.award", "rfq", rfqId, { po: po.number }); return po;
}
export async function decidePR(c: Db, x: Ctx, prId: string, ok: boolean, reason: string) {
  if (!can(x.role, "proc.approve")) throw new UserError("You are not allowed to decide purchase requests.", "denied");
  if (!ok && !reason.trim()) throw new UserError("A reason is required when rejecting.");
  const pr = (await c.query("select * from purchase_requests where id=$1 for update", [prId])).rows[0];
  if (!pr || pr.status !== "open") throw new UserError("Request is no longer open.", "conflict");
  if (pr.requested_by === x.userId) throw new UserError("You cannot decide your own request.", "denied");
  await c.query("update purchase_requests set status=$2, decided_by=$3, decision_reason=$4 where id=$1", [prId, ok ? "approved" : "rejected", x.userId, reason || null]);
  await audit(c, actor(x), ok ? "pr.approve" : "pr.reject", "purchase_request", prId, {}, reason);
}
// ---------- inspection plans ----------
export async function savePlan(c: Db, x: Ctx, a: { itemId: string; kind: string; characteristic: string; unit?: string; min: number | null; max: number | null }) {
  if (!a.characteristic.trim()) throw new UserError("Name the characteristic being checked.");
  if (a.min != null && a.max != null && a.min > a.max) throw new UserError("Minimum cannot exceed maximum.");
  await c.query("insert into inspection_plans(company_id,item_id,kind,characteristic,unit,min_value,max_value) values ($1,$2,$3,$4,$5,$6,$7) on conflict (item_id,kind,characteristic) do update set unit=excluded.unit, min_value=excluded.min_value, max_value=excluded.max_value",
    [x.companyId, a.itemId, a.kind, a.characteristic.trim(), a.unit || null, a.min, a.max]);
  await audit(c, actor(x), "plan.save", "item", a.itemId, { kind: a.kind, characteristic: a.characteristic });
}
/** Copy the plan's characteristic and limits onto a newly raised inspection (one inspection per plan line). */
export async function applyPlan(c: Db, inspId: string, itemId: string, kind: string) {
  const p = (await c.query("select * from inspection_plans where item_id=$1 and kind=$2 order by characteristic limit 1", [itemId, kind])).rows[0];
  if (p) await c.query("update inspections set characteristic=$2, unit=$3, min_value=$4, max_value=$5 where id=$1", [inspId, p.characteristic, p.unit, p.min_value, p.max_value]);
}
// ---------- order amendment ----------
export async function amendLine(c: Db, x: Ctx, lineId: string, qty: number, due: string, reason: string) {
  if (!reason.trim()) throw new UserError("A reason is required to amend a confirmed order.");
  const l = (await c.query("select l.*, o.status ostatus, o.number from sales_order_lines l join sales_orders o on o.id=l.order_id where l.id=$1 for update of l", [lineId])).rows[0];
  if (!l || l.ostatus !== "confirmed") throw new UserError("Only lines on confirmed orders can be amended.", "conflict");
  if (!(qty > 0) || qty < Number(l.shipped_qty)) throw new UserError(`Quantity must be at least what has already shipped (${l.shipped_qty}).`);
  const jobs = (await c.query("select number, status from work_orders where so_line_id=$1 and status in ('released','in_progress')", [lineId])).rows;
  await c.query("update sales_order_lines set qty=$2, due_date=$3 where id=$1", [lineId, qty, due]);
  const res = (await c.query("select coalesce(sum(qty),0) q from reservations where ref_type='sales_order' and ref_id=$1 and status='active'", [lineId])).rows[0].q;
  if (Number(res) > qty) await c.query("update reservations set qty=$2 where ref_id=$1 and status='active' and ref_type='sales_order'", [lineId, qty]);
  await audit(c, actor(x), "so.amend", "sales_order_line", lineId, { from: { qty: l.qty, due: l.due_date }, to: { qty, due } }, reason);
  return { jobs, reservationTrimmed: Number(res) > qty, order: l.number as string };
}
// ---------- count sheets ----------
export async function startCount(c: Db, x: Ctx, locationId: string, sheet: string) {
  const rows = (await c.query(`select b.item_id, b.batch_id, b.qty, i.code ic, ba.code bc from stock_balances b join items i on i.id=b.item_id left join batches ba on ba.id=b.batch_id where b.location_id=$1`, [locationId])).rows;
  if (!rows.length) throw new UserError("That location has no stock to count.");
  for (const r of rows) await c.query("insert into stock_counts(company_id,item_id,location_id,batch_id,system_qty,sheet,item_code,batch_code,counted_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [x.companyId, r.item_id, locationId, r.batch_id, r.qty, sheet, r.ic, r.bc, x.userId]);
  await audit(c, actor(x), "count.start", "location", locationId, { sheet, lines: rows.length }); return rows.length;
}
export async function postCount(c: Db, x: Ctx, sheet: string, reason: string) {
  if (!can(x.role, "inv.adjust")) throw new UserError("You are not allowed to post count adjustments.", "denied");
  const lines = (await c.query("select * from stock_counts where sheet=$1 and status='pending' for update", [sheet])).rows;
  if (!lines.length) throw new UserError("Nothing pending on that sheet.", "conflict");
  if (lines.some((l) => l.counted_qty == null)) throw new UserError("Enter a counted quantity on every line (use 0 for nothing found) before posting.");
  let adj = 0;
  for (const l of lines) { const r = await inv.adjust(c, x, l.item_id, l.batch_id, l.location_id, Number(l.counted_qty), reason || `Count sheet ${sheet}`); if (r.diff !== 0) adj++; await c.query("update stock_counts set status='posted', reason=$2 where id=$1", [l.id, reason || null]); }
  return { lines: lines.length, adjusted: adj };
}
// ---------- closure ----------
export async function requestClosure(c: Db, x: Ctx, reason: string) {
  const { plat } = await import("../db");
  if (!reason.trim()) throw new UserError("Tell us why you are closing (helps us improve).");
  await plat("update companies set closure_requested_at=now() where id=$1", [x.companyId]);
  await audit(c, actor(x), "company.closure_requested", "company", x.companyId, {}, reason);
}
