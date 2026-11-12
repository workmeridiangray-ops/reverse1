import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";

const ST = ["draft", "pending_approval", "approved", "accepted", "rejected", "superseded", "expired"];
export default async function Quotes({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("sales.view"); const sp = await searchParams;
  const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["q.tenant_id=$1", "($2::uuid[] is null or q.branch_id = any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (q) { a.push(like(q)); w.push(`(q.number ilike $${a.length} or c.name ilike $${a.length})`); }
    if (status) { a.push(status); w.push(`q.status=$${a.length}`); }
    const from = `from quotes q join customers c on c.id=q.customer_id and c.tenant_id=q.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select q.*, c.name customer ${from} order by q.created_at desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Quotations" crumbs={[["Sales"], ["Quotations"]]}>{ctx.perms.has("sales.create") && <Link className="btn primary" href="/app/sales/quotes/new">New quotation</Link>}</PageHead>
    <Filters action="/app/sales/quotes" q={q} status={status} statuses={ST} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No quotations" action={ctx.perms.has("sales.create") ? <Link className="btn primary" href="/app/sales/quotes/new">Create the first quotation</Link> : undefined}>Quotations you create appear here.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Number</th><th>Customer</th><th>Status</th><th>Valid until</th><th className="num">Total</th></tr></thead><tbody>
        {d.rows.map((r: any) => <tr key={r.id}><td data-label="Number"><Link href={`/app/sales/quotes/${r.id}`}>{r.number}</Link></td><td data-label="Customer">{r.customer}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Valid until">{r.valid_until ?? "—"}</td><td data-label="Total" className="num">{formatMoney(r.total_paise)}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/sales/quotes" params={{ q, status }} /></div></>);
}
