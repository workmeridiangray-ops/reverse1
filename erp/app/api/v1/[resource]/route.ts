import { NextResponse } from "next/server";
import { withSystem, withTenant } from "@/lib/db";
import { sha256 } from "@/lib/auth/password";

const SQL: Record<string, string> = {
  items: "select id, sku, name, kind, base_unit, sale_price_paise, purchase_price_paise, barcode, status from items where tenant_id=$1 order by sku",
  customers: "select id, code, name, email, phone, gstin, credit_limit_paise, payment_terms_days, status from customers where tenant_id=$1 order by code",
  orders: "select id, number, customer_id, status, order_date, total_paise from sales_orders where tenant_id=$1 order by created_at desc",
  invoices: "select id, number, customer_id, status, issue_date, due_date, total_paise, paid_paise, credited_paise from invoices where tenant_id=$1 order by issue_date desc",
};
const hits = new Map<string, { n: number; reset: number }>();   // per-process limiter; use a shared store when running several instances
export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const sql = SQL[(await params).resource]; if (!sql) return NextResponse.json({ error: "unknown resource" }, { status: 404 });
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!key.startsWith("llk_")) return NextResponse.json({ error: "missing or invalid API key" }, { status: 401 });
  const hash = sha256(key);
  const k = await withSystem(async (db) => (await db.query("select * from api_key_lookup($1)", [hash])).rows[0]);
  if (!k) return NextResponse.json({ error: "missing or invalid API key" }, { status: 401 });
  const now = Date.now(); const h = hits.get(hash) ?? { n: 0, reset: now + 60000 }; if (now > h.reset) { h.n = 0; h.reset = now + 60000; } h.n++; hits.set(hash, h);
  if (h.n > 120) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(Math.ceil((h.reset - now) / 1000)) } });
  const page = Math.max(1, parseInt(new URL(req.url).searchParams.get("page") ?? "1", 10) || 1);
  const rows = await withTenant(k.tenant_id, async (db) => { await db.query("update api_keys set last_used_at=now() where id=$1", [k.key_id]).catch(() => {}); return (await db.query(`${sql} limit 100 offset ${(page - 1) * 100}`, [k.tenant_id])).rows; });
  return NextResponse.json({ page, data: rows });
}
