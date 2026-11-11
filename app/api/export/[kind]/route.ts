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
  const need = kind === "job-costs" ? "cost.read" : "report.read";
  if (!can(role, need) || !can(role, "export") && kind === "job-costs") return new NextResponse("Not allowed", { status: 403 });
  const co = { companyId: a.company.id, userId: a.user.id };
  const { tx } = await import("@/lib/server/db");
  const rows = await tx(async (c) => {
    let out: unknown[][];
    if (kind === "job-costs") out = await accountingExportRows(c);
    else if (kind === "stock") out = [["item", "location", "batch", "batch_status", "qty"], ...(await c.query("select i.code, l.code loc, ba.code batch, ba.status, b.qty from stock_balances b join items i on i.id=b.item_id join locations l on l.id=b.location_id left join batches ba on ba.id=b.batch_id order by i.code")).rows.map((r: any) => [r.code, r.loc, r.batch ?? "", r.status ?? "", r.qty])];
    else if (kind === "audit") { if (!can(role, "audit.read")) throw new Error("denied"); out = [["at", "actor", "action", "entity", "reason"], ...(await c.query("select at, actor_label, action, entity, reason from audit_log where company_id=$1 order by at desc limit 5000", [a.company!.id])).rows.map((r: any) => [r.at.toISOString(), r.actor_label, r.action, r.entity, r.reason ?? ""])]; }
    else throw new Error("unknown");
    await audit(c, { userId: a.user.id, companyId: a.company!.id }, "export." + kind);
    return out;
  }, co).catch((e) => (e.message === "unknown" ? null : e.message === "denied" ? "denied" : null));
  if (rows === "denied") return new NextResponse("Not allowed", { status: 403 });
  if (!rows) return new NextResponse("Unknown export", { status: 404 });
  return new NextResponse(toCsv(rows as unknown[][]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
}
