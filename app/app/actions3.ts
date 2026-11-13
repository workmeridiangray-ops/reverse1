"use server";
import { action, str, num } from "@/lib/server/action";
import { UserError } from "@/lib/server/db";
import * as x from "@/lib/server/svc/extras";
import { parseRupees } from "@/lib/domain/money";
const need = (fd: FormData, k: string, l: string) => { const v = str(fd, k); if (!v) throw new UserError(`${l} is required.`); return v; };
const pos = (fd: FormData, k: string, l: string) => { const v = num(fd, k); if (!Number.isFinite(v) || v <= 0) throw new UserError(`${l} must be greater than zero.`); return v; };
const opt = (fd: FormData, k: string) => (str(fd, k) === "" ? null : Number(str(fd, k)));
export const createPRAction = action("proc.write", async ({ fd, ctx, c }) => `Request ${await x.createPR(c, ctx, need(fd, "item", "Item"), pos(fd, "qty", "Quantity"), need(fd, "needed", "Needed by"), str(fd, "reason"))} raised.`);
export const decidePRAction = action("proc.approve", async ({ fd, ctx, c }) => { const ok = str(fd, "decision") === "approve"; await x.decidePR(c, ctx, need(fd, "id", "Request"), ok, str(fd, "reason")); return ok ? "Approved." : "Rejected."; });
export const openRfqAction = action("proc.write", async ({ fd, ctx, c }) => ({ redirect: "/app/purchasing/rfq/" + (await x.openRfq(c, ctx, need(fd, "id", "Request"))) }));
export const addQuoteAction = action("proc.write", async ({ fd, ctx, c }) => {
  let p: number; try { p = parseRupees(need(fd, "price", "Unit price")); } catch (e: any) { throw new UserError(e.message); }
  await x.addQuote(c, ctx, need(fd, "rfq", "RFQ"), need(fd, "supplier", "Supplier"), p, Math.round(Number(str(fd, "lead") || 0)), str(fd, "note")); return "Quote recorded.";
});
export const awardAction = action("proc.write", async ({ fd, ctx, c }) => { const po = await x.awardRfq(c, ctx, need(fd, "rfq", "RFQ"), need(fd, "quote", "Quote")); return { redirect: "/app/purchasing/" + po.id }; });
export const savePlanAction = action("qa.write", async ({ fd, ctx, c }) => { await x.savePlan(c, ctx, { itemId: need(fd, "item", "Item"), kind: need(fd, "kind", "Inspection type"), characteristic: need(fd, "ch", "Characteristic"), unit: str(fd, "unit"), min: opt(fd, "min"), max: opt(fd, "max") }); return "Plan saved. New inspections of this item will carry these limits."; });
export const amendLineAction = action("sales.write", async ({ fd, ctx, c }) => {
  const r = await x.amendLine(c, ctx, need(fd, "line", "Line"), pos(fd, "qty", "Quantity"), need(fd, "due", "Due date"), str(fd, "reason"));
  return `Order ${r.order} amended.` + (r.jobs.length ? ` Review released jobs: ${r.jobs.map((j) => j.number).join(", ")}.` : "") + (r.reservationTrimmed ? " Stock reservation reduced to the new quantity." : "") + " Run planning again to refresh suggestions.";
});
export const startCountAction = action("inv.adjust", async ({ fd, ctx, c }) => { const n = await x.startCount(c, ctx, need(fd, "loc", "Location"), need(fd, "sheet", "Sheet name")); return `Count sheet created with ${n} lines (system quantities are hidden on the sheet — blind count).`; });
export const saveCountLines = action("inv.post", async ({ fd, c }) => {
  let n = 0; for (const [k, v] of fd.entries()) if (k.startsWith("q_") && String(v).trim() !== "") { const q = Number(v); if (!Number.isFinite(q) || q < 0) throw new UserError("Counted quantities must be zero or more."); await c.query("update stock_counts set counted_qty=$2 where id=$1 and status='pending'", [k.slice(2), q]); n++; }
  return `${n} line(s) saved.`;
});
export const postCountAction = action("inv.adjust", async ({ fd, ctx, c }) => { const r = await x.postCount(c, ctx, need(fd, "sheet", "Sheet"), str(fd, "reason")); return `Posted: ${r.adjusted} of ${r.lines} lines needed an adjustment.`; });
export const closureAction = action("settings", async ({ fd, ctx, c }) => { await x.requestClosure(c, ctx, str(fd, "reason")); return "Closure requested. Download your exports now; our team will contact you to confirm."; });
