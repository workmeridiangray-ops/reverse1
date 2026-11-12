import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
export default async function Dispatches({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("sales.view"); const sp = await searchParams; const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["d.tenant_id=$1", "($2::uuid[] is null or o.branch_id = any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (q) { a.push(like(q)); w.push(`(d.number ilike $${a.length} or o.number ilike $${a.length} or d.tracking_ref ilike $${a.length})`); }
    if (status) { a.push(status); w.push(`d.status=$${a.length}`); }
    const from = `from dispatches d join sales_orders o on o.id=d.order_id and o.tenant_id=d.tenant_id join customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select d.*, o.number order_no, c.name customer ${from} order by d.created_at desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Dispatches" crumbs={[["Fulfilment"], ["Dispatches"]]} sub="Dispatches are created from a confirmed sales order." />
    <Filters action="/app/fulfilment/dispatches" q={q} status={status} statuses={["posted", "delivered", "reversed"]} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No dispatches yet">Open a confirmed order and use “Dispatch goods”.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Dispatch</th><th>Order</th><th>Customer</th><th>Carrier / tracking</th><th>Status</th></tr></thead><tbody>
        {d.rows.map((r: any) => <tr key={r.id}><td data-label="Dispatch"><Link href={`/app/fulfilment/dispatches/${r.id}`}>{r.number}</Link></td><td data-label="Order"><Link href={`/app/sales/orders/${r.order_id}`}>{r.order_no}</Link></td><td data-label="Customer">{r.customer}</td><td data-label="Tracking">{[r.carrier, r.tracking_ref].filter(Boolean).join(" · ") || "—"}</td><td data-label="Status"><Badge status={r.status} /></td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/fulfilment/dispatches" params={{ q, status }} /></div></>);
}
