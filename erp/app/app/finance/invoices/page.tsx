import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";
export default async function Invoices({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("finance.view"); const sp = await searchParams; const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["i.tenant_id=$1", "($2::uuid[] is null or i.branch_id=any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (q) { a.push(like(q)); w.push(`(i.number ilike $${a.length} or c.name ilike $${a.length})`); } if (status === "overdue") w.push("i.status in ('posted','partially_paid') and i.due_date < current_date"); else if (status) { a.push(status); w.push(`i.status=$${a.length}`); }
    const from = `from invoices i join customers c on c.id=i.customer_id and c.tenant_id=i.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select i.*, c.name customer ${from} order by i.issue_date desc, i.number desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Customer invoices" crumbs={[["Finance"], ["Invoices"]]} sub="Invoices are raised from sales orders once goods are dispatched." />
    <Filters action="/app/finance/invoices" q={q} status={status} statuses={["posted", "partially_paid", "paid", "overdue"]} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No invoices">Open a dispatched order and choose “Create invoice”.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead><tbody>
        {d.rows.map((r: any) => { const bal = r.total_paise - r.paid_paise - r.credited_paise; const od = bal > 0 && r.due_date < new Date().toISOString().slice(0, 10); return <tr key={r.id}><td data-label="Invoice"><Link href={`/app/finance/invoices/${r.id}`}>{r.number}</Link></td><td data-label="Customer">{r.customer}</td><td data-label="Issued">{r.issue_date}</td><td data-label="Due" style={od ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{r.due_date}{od && " · overdue"}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Total" className="num">{formatMoney(r.total_paise)}</td><td data-label="Balance" className="num">{formatMoney(bal)}</td></tr>; })}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/finance/invoices" params={{ q, status }} /></div></>);
}
