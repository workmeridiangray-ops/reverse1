import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Pager } from "@/components/ui";
import { paging, pages, type SP } from "@/lib/list";
import { sourceLink } from "@/lib/erp/links";
import { formatMoney } from "@/lib/money";
export default async function AccountLedger({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound(); const ctx = await requireTenant("finance.view"); const { page, limit, offset } = paging(await searchParams);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const a = (await db.query("select * from accounts where id=$1 and tenant_id=$2", [id, ctx.tenant.id])).rows[0]; if (!a) return null;
    const w = "l.account_id=$1 and l.tenant_id=$2 and j.status in ('posted','reversed')";
    return { a, total: Number((await db.query(`select count(*) c from journal_lines l join journals j on j.id=l.journal_id and j.tenant_id=l.tenant_id where ${w}`, [id, ctx.tenant.id])).rows[0].c),
      rows: (await db.query(`select l.debit_paise, l.credit_paise, j.id jid, j.number, j.entry_date, j.memo, j.source_type, j.source_id, sum(l.debit_paise - l.credit_paise) over (order by j.entry_date, j.number, l.id) run from journal_lines l join journals j on j.id=l.journal_id and j.tenant_id=l.tenant_id where ${w} order by j.entry_date desc, j.number desc limit ${limit} offset ${offset}`, [id, ctx.tenant.id])).rows };
  });
  if (!d) notFound();
  return (<><PageHead title={`${d.a.code} — ${d.a.name}`} crumbs={[["Finance"], ["Accounts", "/app/finance/accounts"], [d.a.code]]} sub="Account ledger. Each line opens its journal and source document." />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>Date</th><th>Journal</th><th>Memo</th><th>Source</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead><tbody>
      {d.rows.map((r: any, i: number) => { const s = sourceLink(r.source_type, r.source_id); return <tr key={i}><td data-label="Date">{r.entry_date}</td><td data-label="Journal"><Link href={`/app/finance/journals/${r.jid}`}>{r.number}</Link></td><td data-label="Memo">{r.memo}</td><td data-label="Source">{s ? <Link href={s}>{r.source_type.replace("_", " ")}</Link> : "—"}</td><td data-label="Debit" className="num">{r.debit_paise ? formatMoney(r.debit_paise) : ""}</td><td data-label="Credit" className="num">{r.credit_paise ? formatMoney(r.credit_paise) : ""}</td></tr>; })}</tbody></table>
      <Pager page={page} pages={pages(d.total)} total={d.total} base={`/app/finance/accounts/${id}`} params={{}} /></div></>);
}
