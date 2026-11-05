import { NextResponse } from "next/server";
import { getCtx } from "@/lib/server/auth";
import { toMajorString } from "@/lib/rules/money";
import { formatQty } from "@/lib/rules/qty";

export const dynamic = "force-dynamic";
const esc = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
const csv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  const c = await getCtx();
  if (c === "none") return new NextResponse("Sign in required", { status: 401 });
  if (c === "no-tenant" || c.tenant.locked || !c.can("export") || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Forbidden", { status: 403 });
  const out = await c.run(async (db) => {
    const p = await db.maybe<{ code: string }>("SELECT code FROM projects WHERE id=$1", [id]);
    if (!p) return null;
    await db.exec("INSERT INTO audit_log(tenant_id,user_id,action,entity,entity_id,detail) VALUES ($1,$2,'export',$3,$4,'{}')", [c.tenant.id, c.user.id, kind, id]);
    if (kind === "boq") {
      const r = await db.q<{ code: string; description: string; unit: string; qty_milli: number; rate_minor: number }>("SELECT code,description,unit,qty_milli,rate_minor FROM boq_items WHERE project_id=$1 ORDER BY code", [id]);
      return { name: `${p.code}-boq.csv`, body: csv([["code", "description", "unit", "quantity", "rate"], ...r.map((x) => [x.code, x.description, x.unit, formatQty(x.qty_milli), toMajorString(x.rate_minor, "INR")])]) };
    }
    if (kind === "bills") {
      if (!c.can("bill.view")) return "forbidden";
      const r = await db.q<{ bill_no: number; status: string; claimed_gross_minor: number; certified_gross_minor: number; retention_minor: number; advance_recovery_minor: number; other_deduction_minor: number; net_minor: number }>("SELECT bill_no,status,claimed_gross_minor,certified_gross_minor,retention_minor,advance_recovery_minor,other_deduction_minor,net_minor FROM bills WHERE project_id=$1 ORDER BY bill_no", [id]);
      return { name: `${p.code}-bills.csv`, body: csv([["bill", "status", "claimed_gross", "certified_gross", "retention", "advance_recovery", "other_deductions", "net_payable"], ...r.map((x) => [x.bill_no, x.status, ...[x.claimed_gross_minor, x.certified_gross_minor, x.retention_minor, x.advance_recovery_minor, x.other_deduction_minor, x.net_minor].map((m) => toMajorString(m, "INR"))])]) };
    }
    return null;
  });
  if (out === "forbidden") return new NextResponse("Forbidden", { status: 403 });
  if (!out) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(out.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.name}"`, "Cache-Control": "private, no-store" } });
}
