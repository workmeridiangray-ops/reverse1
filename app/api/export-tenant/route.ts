import { NextResponse } from "next/server";
import { getCtx } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export async function GET() {
  const c = await getCtx();
  if (c === "none") return new NextResponse("Sign in required", { status: 401 });
  if (c === "no-tenant" || c.role !== "owner") return new NextResponse("Forbidden", { status: 403 });
  const out = await c.run(async (db) => {
    const t = async (sql: string) => db.q(sql);
    await db.exec("INSERT INTO audit_log(tenant_id,user_id,action,entity,detail) VALUES ($1,$2,'export','tenant','{}')", [c.tenant.id, c.user.id]);
    return {
      exportedAt: new Date().toISOString(), tenant: c.tenant.name,
      projects: await t("SELECT * FROM projects"), boq_items: await t("SELECT * FROM boq_items"), contracts: await t("SELECT * FROM contracts"),
      measurements: await t("SELECT * FROM measurements"), variations: await t("SELECT * FROM variations"), bills: await t("SELECT * FROM bills"), bill_lines: await t("SELECT * FROM bill_lines"),
      invoices: await t("SELECT * FROM client_invoices"), receipts: await t("SELECT * FROM receipts"), disputes: await t("SELECT * FROM disputes"),
      suppliers: await t("SELECT * FROM suppliers"), purchase_orders: await t("SELECT * FROM purchase_orders"), po_lines: await t("SELECT * FROM po_lines"),
    };
  });
  return new NextResponse(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="export.json"', "Cache-Control": "private, no-store" } });
}
