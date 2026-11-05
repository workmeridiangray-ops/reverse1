import { serviceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Read-only, tenant-scoped, field-whitelisted API. Authenticated by `Authorization: Bearer berp_…`. */
const RESOURCES: Record<string, { table: string; cols: string; order: string }> = {
  items: { table: "items", cols: "id,sku,name,kind,unit,sale_price_paise,reorder_level,active", order: "sku" },
  customers: { table: "customers", cols: "id,name,email,phone,gstin,active", order: "name" },
  suppliers: { table: "suppliers", cols: "id,name,email,phone,gstin,active", order: "name" },
  stock: { table: "stock_levels", cols: "item_id,warehouse_id,sku,item_name,warehouse_name,on_hand,reserved", order: "sku" },
  "sales-orders": { table: "sales_orders", cols: "id,number,status,customer_id,warehouse_id,order_date", order: "number" },
  invoices: { table: "invoices", cols: "id,number,customer_id,invoice_date,subtotal_paise,tax_paise,total_paise,paid_paise,credited_paise,status", order: "number" },
};

export async function GET(req: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  const spec = RESOURCES[resource];
  if (!spec) return Response.json({ error: "unknown resource", resources: Object.keys(RESOURCES) }, { status: 404 });
  const m = /^Bearer (berp_[0-9a-f]{64})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return Response.json({ error: "missing or malformed API key" }, { status: 401 });
  const sb = serviceClient();
  const { data: tenant, error } = await sb.rpc("api_resolve_key", { p_secret: m[1] });
  if (error || !tenant) {
    const limited = /rate limit/.test(error?.message ?? "");
    return Response.json({ error: limited ? "rate limit exceeded (120/min)" : "invalid or revoked API key" }, { status: limited ? 429 : 401, headers: limited ? { "Retry-After": "60" } : {} });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
  const { data, error: qerr } = await sb.from(spec.table).select(spec.cols).eq("tenant_id", tenant as string).order(spec.order).range(offset, offset + limit);
  if (qerr) return Response.json({ error: "query failed" }, { status: 500 });
  const rows = data ?? [];
  return Response.json({ data: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null });
}
