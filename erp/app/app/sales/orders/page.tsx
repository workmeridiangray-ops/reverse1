import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";
const ST = ["draft", "confirmed", "credit_hold", "partially_fulfilled", "fulfilled", "closed", "cancelled"];
export default async function Orders({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("sales.view"); const sp = await searchParams;
  const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["o.tenant_id=$1", "($2::uuid[] is null or o.branch_id = any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (q) { a.push(like(q)); w.push(`(o.number ilike $${a.length} or c.name ilike $${a.length})`); }
    if (status) { a.push(status); w.push(`o.status=$${a.length}`); }
    const from = `from sales_orders o join customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select o.*, c.name customer, (select coalesce(sum(qty-reserved_qty-dispatched_qty),0) from sales_order_lines l where l.order_id=o.id) short ${from} order by o.created_at desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Sales orders" crumbs={[["Sales"], ["Orders"]]}>{ctx.perms.has("sales.create") && <Link className="btn primary" href="/app/sales/orders/new">New order</Link>}</PageHead>
    <Filters action="/app/sales/orders" q={q} status={status} statuses={ST} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No sales orders">Create an order directly or accept an approved quotation.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Date</th><th className="num">Unreserved qty</th><th className="num">Total</th></tr></thead><tbody>
        {d.rows.map((r: any) => <tr key={r.id}><td data-label="Order"><Link href={`/app/sales/orders/${r.id}`}>{r.number}</Link></td><td data-label="Customer">{r.customer}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Date">{r.order_date}</td><td data-label="Unreserved" className="num">{["confirmed", "partially_fulfilled"].includes(r.status) && Number(r.short) > 0 ? <span className="badge warn">short {Number(r.short) / 1000}</span> : "—"}</td><td data-label="Total" className="num">{formatMoney(r.total_paise)}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/sales/orders" params={{ q, status }} /></div></>);
}
