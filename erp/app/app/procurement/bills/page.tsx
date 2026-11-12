import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";
export default async function Bills({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("procurement.view"); if (!ctx.perms.has("finance.view") && !ctx.perms.has("procurement.approve")) { /* purchasers see status only */ }
  const sp = await searchParams; const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["b.tenant_id=$1"]; const a: any[] = [ctx.tenant.id];
    if (q) { a.push(like(q)); w.push(`(b.number ilike $${a.length} or b.supplier_ref ilike $${a.length} or s.name ilike $${a.length})`); } if (status) { a.push(status); w.push(`b.status=$${a.length}`); }
    const from = `from supplier_bills b join suppliers s on s.id=b.supplier_id and s.tenant_id=b.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select b.*, s.name supplier ${from} order by b.created_at desc limit ${limit} offset ${offset}`, a)).rows };
  });
  const today = new Date().toISOString().slice(0, 10);
  return (<><PageHead title="Supplier bills" crumbs={[["Purchasing"], ["Bills"]]} sub="Bills are entered from the purchase order so they can be matched to what was received." />
    <Filters action="/app/procurement/bills" q={q} status={status} statuses={["exception", "posted", "partially_paid", "paid", "void"]} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No supplier bills">Open a purchase order with received goods and choose “Enter supplier invoice”.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Bill</th><th>Supplier / ref</th><th>Status</th><th>Due</th><th className="num">Total</th><th className="num">Balance</th></tr></thead><tbody>
        {d.rows.map((r: any) => <tr key={r.id}><td data-label="Bill"><Link href={`/app/procurement/bills/${r.id}`}>{r.number}</Link></td><td data-label="Supplier">{r.supplier} · {r.supplier_ref}</td><td data-label="Status"><Badge status={r.status} />{r.match_status === "exception_approved" && <> <span className="badge warn">exception approved</span></>}</td><td data-label="Due" style={r.due_date < today && ["posted", "partially_paid"].includes(r.status) ? { color: "var(--bad)" } : undefined}>{r.due_date}</td><td data-label="Total" className="num">{formatMoney(r.total_paise)}</td><td data-label="Balance" className="num">{formatMoney(r.total_paise - r.paid_paise)}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/procurement/bills" params={{ q, status }} /></div></>);
}
