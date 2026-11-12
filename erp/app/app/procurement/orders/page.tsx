import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";
export default async function POs({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("procurement.view"); const sp = await searchParams; const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["p.tenant_id=$1", "($2::uuid[] is null or p.branch_id=any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (q) { a.push(like(q)); w.push(`(p.number ilike $${a.length} or s.name ilike $${a.length})`); } if (status) { a.push(status); w.push(`p.status=$${a.length}`); }
    const from = `from purchase_orders p join suppliers s on s.id=p.supplier_id and s.tenant_id=p.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select p.*, s.name supplier ${from} order by p.created_at desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Purchase orders" crumbs={[["Purchasing"], ["Orders"]]}>{ctx.perms.has("procurement.create") && <Link className="btn primary" href="/app/procurement/orders/new">New purchase order</Link>}</PageHead>
    <Filters action="/app/procurement/orders" q={q} status={status} statuses={["draft", "pending_approval", "approved", "sent", "acknowledged", "partially_received", "received", "cancelled"]} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No purchase orders">Create one directly or convert an approved purchase request.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Expected</th><th className="num">Total</th></tr></thead><tbody>
        {d.rows.map((r: any) => <tr key={r.id}><td data-label="PO"><Link href={`/app/procurement/orders/${r.id}`}>{r.number}</Link></td><td data-label="Supplier">{r.supplier}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Expected">{r.expected_date ?? "—"}</td><td data-label="Total" className="num">{formatMoney(r.total_paise)}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/procurement/orders" params={{ q, status }} /></div></>);
}
