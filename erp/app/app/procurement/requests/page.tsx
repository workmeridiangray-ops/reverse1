import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
export default async function Requests({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("procurement.view"); const sp = await searchParams; const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["r.tenant_id=$1", "($2::uuid[] is null or r.branch_id=any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (q) { a.push(like(q)); w.push(`(r.number ilike $${a.length} or r.reason ilike $${a.length})`); } if (status) { a.push(status); w.push(`r.status=$${a.length}`); }
    const from = `from purchase_requests r left join sales_orders o on o.id=r.source_order_id and o.tenant_id=r.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select r.*, o.number order_no ${from} order by r.created_at desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Purchase requests" crumbs={[["Purchasing"], ["Requests"]]}>{ctx.perms.has("procurement.create") && <Link className="btn primary" href="/app/procurement/requests/new">New request</Link>}</PageHead>
    <Filters action="/app/procurement/requests" q={q} status={status} statuses={["draft", "pending_approval", "approved", "rejected", "converted", "cancelled"]} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No purchase requests">Requests are raised manually or from a sales-order shortage.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Request</th><th>Reason</th><th>For order</th><th>Status</th><th>Created</th></tr></thead><tbody>
        {d.rows.map((r: any) => <tr key={r.id}><td data-label="Request"><Link href={`/app/procurement/requests/${r.id}`}>{r.number}</Link></td><td data-label="Reason">{r.reason ?? "—"}</td><td data-label="Order">{r.order_no ?? "—"}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Created">{new Date(r.created_at).toLocaleDateString("en-IN")}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/procurement/requests" params={{ q, status }} /></div></>);
}
