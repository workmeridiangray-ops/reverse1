import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { trialBalance, profitAndLoss, receivablesAgeing } from "@/lib/erp/finance";
import { audit } from "@/lib/audit";

type Spec = { perm: string; header: string[]; sql?: string; run?: (db: any, t: string, q: URLSearchParams, branchScope: string[] | null) => Promise<unknown[][]> };
const SPECS: Record<string, Spec> = {
  customers: { perm: "masters.view", header: ["code", "name", "email", "phone", "gstin", "credit_limit_rupees", "payment_terms_days", "status"], sql: "select code,name,email,phone,gstin,credit_limit_paise/100.0,payment_terms_days,status from customers where tenant_id=$1 order by code" },
  suppliers: { perm: "masters.view", header: ["code", "name", "email", "phone", "gstin", "lead_time_days", "status"], sql: "select code,name,email,phone,gstin,lead_time_days,status from suppliers where tenant_id=$1 order by code" },
  items: { perm: "masters.view", header: ["sku", "name", "kind", "base_unit", "sale_price_rupees", "purchase_price_rupees", "barcode", "status"], sql: "select sku,name,kind,base_unit,sale_price_paise/100.0,purchase_price_paise/100.0,barcode,status from items where tenant_id=$1 order by sku" },
  stock: { perm: "inventory.view", header: ["sku", "item", "warehouse", "on_hand", "reserved", "available", "in_transit"], sql: "select i.sku,i.name,w.name,b.on_hand/1000.0,b.reserved/1000.0,(b.on_hand-b.reserved)/1000.0,b.in_transit/1000.0 from stock_balances b join items i on i.id=b.item_id and i.tenant_id=b.tenant_id join warehouses w on w.id=b.warehouse_id and w.tenant_id=b.tenant_id where b.tenant_id=$1 order by i.sku" },
  invoices: { perm: "finance.view", header: ["number", "customer", "issue_date", "due_date", "status", "total_rupees", "paid_rupees", "credited_rupees"], sql: "select i.number,c.name,i.issue_date,i.due_date,i.status,i.total_paise/100.0,i.paid_paise/100.0,i.credited_paise/100.0 from invoices i join customers c on c.id=i.customer_id and c.tenant_id=i.tenant_id where i.tenant_id=$1 order by i.issue_date desc" },
  orders: { perm: "sales.view", header: ["number", "customer", "date", "status", "total_rupees"], sql: "select o.number,c.name,o.order_date,o.status,o.total_paise/100.0 from sales_orders o join customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id where o.tenant_id=$1 order by o.created_at desc" },
  bills: { perm: "finance.view", header: ["number", "supplier", "supplier_invoice", "bill_date", "due_date", "status", "total_rupees", "paid_rupees"], sql: "select b.number,s.name,b.supplier_ref,b.bill_date,b.due_date,b.status,b.total_paise/100.0,b.paid_paise/100.0 from supplier_bills b join suppliers s on s.id=b.supplier_id and s.tenant_id=b.tenant_id where b.tenant_id=$1 order by b.bill_date desc" },
  journals: { perm: "finance.view", header: ["journal", "date", "status", "account", "debit_rupees", "credit_rupees", "memo"], sql: "select j.number,j.entry_date,j.status,a.code||' '||a.name,l.debit_paise/100.0,l.credit_paise/100.0,j.memo from journal_lines l join journals j on j.id=l.journal_id and j.tenant_id=l.tenant_id join accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id where l.tenant_id=$1 order by j.entry_date, j.number" },
  "stock-ledger": { perm: "inventory.view", header: ["id", "when", "sku", "warehouse", "kind", "qty_change", "source"], sql: "select m.id,m.created_at,i.sku,w.name,m.kind,m.qty_delta/1000.0,m.doc_type from stock_movements m join items i on i.id=m.item_id and i.tenant_id=m.tenant_id join warehouses w on w.id=m.warehouse_id and w.tenant_id=m.tenant_id where m.tenant_id=$1 order by m.id" },
  "trial-balance": { perm: "finance.view", header: ["code", "account", "type", "debit_rupees", "credit_rupees"], run: async (db, t, q) => (await trialBalance(db, t, q.get("asof") || new Date().toISOString().slice(0, 10))).map((r) => [r.code, r.name, r.type, Number(r.debit) / 100, Number(r.credit) / 100]) },
  pnl: { perm: "finance.view", header: ["code", "account", "type", "net_rupees"], run: async (db, t, q) => (await profitAndLoss(db, t, q.get("from") || "1970-01-01", q.get("to") || new Date().toISOString().slice(0, 10))).map((r) => [r.code, r.name, r.type, Number(r.net_credit) / 100]) },
  ageing: { perm: "finance.view", header: ["customer", "current", "1-30", "31-60", "61-90", "90+", "total"], run: async (db, t, q) => (await receivablesAgeing(db, t, q.get("asof") || new Date().toISOString().slice(0, 10))).map((r: any) => [r.name, r.current_amt / 100, r.d1_30 / 100, r.d31_60 / 100, r.d61_90 / 100, r.d90_plus / 100, r.total / 100]) },
  audit: { perm: "audit.view", header: ["id", "when", "actor", "action", "entity", "reason"], sql: "select id,created_at,coalesce(actor_label,actor_user_id::text),action,entity_type||' '||coalesce(entity_id,''),reason from audit_log where tenant_id=$1 order by id desc limit 50000" },
};

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params; const spec = SPECS[kind];
  const ctx = await getCtx();
  if (!ctx?.tenant || !ctx.membership) return new NextResponse("Not signed in", { status: 401 });
  if (!spec) return new NextResponse("Unknown export", { status: 404 });
  if (!(ctx.perms.has(spec.perm) && (ctx.perms.has("reports.export") || ctx.perms.has("data.export")))) return new NextResponse("You do not have permission to export this.", { status: 403 });
  if (ctx.membership.branchIds && !(["customers", "suppliers", "items"].includes(kind))) return new NextResponse("Exports of transactions are limited to users with access to all branches.", { status: 403 });
  const url = new URL(req.url);
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => {
    const r = spec.run ? await spec.run(db, ctx.tenant!.id, url.searchParams, ctx.membership!.branchIds) : (await db.query({ text: spec.sql!, values: [ctx.tenant!.id], rowMode: "array" })).rows;
    await audit(db, { tenantId: ctx.tenant!.id, actorUserId: ctx.user.id, action: "export.downloaded", entityType: "export", entityId: kind, detail: { rows: r.length } });
    return r as unknown[][];
  });
  return new NextResponse(toCsv(spec.header, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
}
