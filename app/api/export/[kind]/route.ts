import { NextResponse } from "next/server";
import { getAuth } from "@/lib/server/auth";
import { can } from "@/lib/server/perms";
import { rd } from "@/lib/server/read";
import { toCsv } from "@/lib/server/csv";
import { accountingExportRows } from "@/lib/server/svc/costing";
import { audit } from "@/lib/server/audit";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const a = await getAuth();
  if (!a || "expired" in a || !a.company || !a.membership) return new NextResponse("Sign in required", { status: 401 });
  const { kind } = await params; const role = a.membership.role;
  const need = kind === "job-costs" ? "cost.read" : ["items", "movements", "sales-orders", "purchase-orders", "work-orders"].includes(kind) ? "export" : "report.read";
  if (!can(role, need) || !can(role, "export") && kind === "job-costs") return new NextResponse("Not allowed", { status: 403 });
  const co = { companyId: a.company.id, userId: a.user.id, plantIds: a.membership.plantIds };
  const { tx } = await import("@/lib/server/db");
  const rows = await tx(async (c) => {
    let out: unknown[][];
    if (kind === "job-costs") out = await accountingExportRows(c);
    else if (kind === "stock") out = [["item", "location", "batch", "batch_status", "qty"], ...(await c.query("select i.code, l.code loc, ba.code batch, ba.status, b.qty from stock_balances b join items i on i.id=b.item_id join locations l on l.id=b.location_id left join batches ba on ba.id=b.batch_id order by i.code")).rows.map((r: any) => [r.code, r.loc, r.batch ?? "", r.status ?? "", r.qty])];
    else if (kind === "items") out = [["code", "name", "type", "unit", "tracking", "lot_size", "lead_time_days", "std_cost_paise"], ...(await c.query("select * from items order by code")).rows.map((r: any) => [r.code, r.name, r.kind, r.uom, r.tracking, r.lot_size, r.lead_time_days, r.std_cost_paise])];
    else if (kind === "movements") out = [["seq", "posted_at", "item", "kind", "location", "batch", "qty", "unit_cost_paise", "note"], ...(await c.query("select m.*, i.code ic, l.code lc, b.code bc from stock_movements m join items i on i.id=m.item_id join locations l on l.id=m.location_id left join batches b on b.id=m.batch_id order by m.seq")).rows.map((r: any) => [r.seq, r.posted_at.toISOString(), r.ic, r.kind, r.lc, r.bc ?? "", r.qty, r.unit_cost_paise, r.note ?? ""])];
    else if (kind === "sales-orders") out = [["order", "customer", "line", "item", "qty", "shipped", "due", "status"], ...(await c.query("select o.number, cu.name, l.line_no, i.code, l.qty, l.shipped_qty, l.due_date, o.status from sales_order_lines l join sales_orders o on o.id=l.order_id join customers cu on cu.id=o.customer_id join items i on i.id=l.item_id order by o.number, l.line_no")).rows.map((r: any) => Object.values(r))];
    else if (kind === "purchase-orders") out = [["po", "supplier", "item", "qty", "received", "price_paise", "due", "status"], ...(await c.query("select p.number, s.name, i.code, l.qty, l.received_qty, l.unit_price_paise, l.due_date, p.status from purchase_order_lines l join purchase_orders p on p.id=l.po_id join suppliers s on s.id=p.supplier_id join items i on i.id=l.item_id order by p.number")).rows.map((r: any) => Object.values(r))];
    else if (kind === "work-orders") out = [["job", "item", "qty", "good", "scrap", "due", "status"], ...(await c.query("select w.number, i.code, w.qty, w.completed_qty, w.scrap_qty, w.due_date, w.status from work_orders w join items i on i.id=w.item_id order by w.number")).rows.map((r: any) => Object.values(r))];
    else if (kind === "audit") { if (!can(role, "audit.read")) throw new Error("denied"); out = [["at", "actor", "action", "entity", "reason"], ...(await c.query("select at, actor_label, action, entity, reason from audit_log where company_id=$1 order by at desc limit 5000", [a.company!.id])).rows.map((r: any) => [r.at.toISOString(), r.actor_label, r.action, r.entity, r.reason ?? ""])]; }
    else throw new Error("unknown");
    await audit(c, { userId: a.user.id, companyId: a.company!.id }, "export." + kind);
    return out;
  }, co).catch((e) => (e.message === "unknown" ? null : e.message === "denied" ? "denied" : null));
  if (rows === "denied") return new NextResponse("Not allowed", { status: 403 });
  if (!rows) return new NextResponse("Unknown export", { status: 404 });
  return new NextResponse(toCsv(rows as unknown[][]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
}
