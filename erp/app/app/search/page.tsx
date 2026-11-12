import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Empty } from "@/components/ui";
import { like, sp1, type SP } from "@/lib/list";
export default async function Search({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant(); const q = sp1((await searchParams).q).trim(); const p = ctx.perms; const sc = ctx.membership.branchIds;
  const groups: { title: string; rows: { label: string; href: string }[] }[] = [];
  if (q.length >= 2) await withTenantSystem(ctx.tenant.id, async (db) => {
    const L = like(q); const add = async (title: string, perm: string, sql: string, map: (r: any) => { label: string; href: string }) => { if (!p.has(perm)) return; const rows = (await db.query(sql, [ctx.tenant.id, L, sc])).rows; if (rows.length) groups.push({ title, rows: rows.map(map) }); };
    await add("Customers", "masters.view", "select id, code, name from customers where tenant_id=$1 and (name ilike $2 or code ilike $2 or email ilike $2) limit 6", (r) => ({ label: `${r.code} — ${r.name}`, href: `/app/masters/customers/${r.id}` }));
    await add("Suppliers", "masters.view", "select id, code, name from suppliers where tenant_id=$1 and (name ilike $2 or code ilike $2) limit 6", (r) => ({ label: `${r.code} — ${r.name}`, href: `/app/masters/suppliers/${r.id}` }));
    await add("Items", "masters.view", "select id, sku, name from items where tenant_id=$1 and (name ilike $2 or sku ilike $2 or barcode ilike $2) limit 6", (r) => ({ label: `${r.sku} — ${r.name}`, href: `/app/masters/items/${r.id}` }));
    await add("Sales orders", "sales.view", "select id, number from sales_orders where tenant_id=$1 and number ilike $2 and ($3::uuid[] is null or branch_id=any($3)) limit 6", (r) => ({ label: r.number, href: `/app/sales/orders/${r.id}` }));
    await add("Quotations", "sales.view", "select id, number from quotes where tenant_id=$1 and number ilike $2 and ($3::uuid[] is null or branch_id=any($3)) limit 6", (r) => ({ label: r.number, href: `/app/sales/quotes/${r.id}` }));
    await add("Purchase orders", "procurement.view", "select id, number from purchase_orders where tenant_id=$1 and number ilike $2 and ($3::uuid[] is null or branch_id=any($3)) limit 6", (r) => ({ label: r.number, href: `/app/procurement/orders/${r.id}` }));
    await add("Invoices", "finance.view", "select id, number from invoices where tenant_id=$1 and number ilike $2 and ($3::uuid[] is null or branch_id=any($3)) limit 6", (r) => ({ label: r.number, href: `/app/finance/invoices/${r.id}` }));
    await add("Supplier bills", "procurement.view", "select id, number, supplier_ref from supplier_bills where tenant_id=$1 and (number ilike $2 or supplier_ref ilike $2) and $3::uuid[] is null limit 6", (r) => ({ label: `${r.number} (${r.supplier_ref})`, href: `/app/procurement/bills/${r.id}` }));
  });
  return (<><PageHead title="Search" sub={q ? `Results for “${q}”` : "Type at least 2 characters"} />
    {q.length >= 2 && groups.length === 0 ? <div className="card"><Empty title="No matches">Try a customer name, SKU, barcode or document number. Results are limited to what your role can see.</Empty></div> : groups.map((g) => <div className="card" key={g.title}><h3>{g.title}</h3>{g.rows.map((r) => <p key={r.href}><Link href={r.href}>{r.label}</Link></p>)}</div>)}</>);
}
