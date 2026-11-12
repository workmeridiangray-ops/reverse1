import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
import { StatusButton } from "@/components/StatusButton";
import { postJournalAction } from "../actions";
import { formatMoney } from "@/lib/money";
export default async function Journals({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("finance.view"); const sp = await searchParams; const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["j.tenant_id=$1"]; const a: any[] = [ctx.tenant.id];
    if (q) { a.push(like(q)); w.push(`(j.number ilike $${a.length} or j.memo ilike $${a.length})`); } if (status) { a.push(status); w.push(`j.status=$${a.length}`); }
    const from = `from journals j where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select j.*, (select coalesce(sum(debit_paise),0) from journal_lines l where l.journal_id=j.id) amount ${from} order by j.entry_date desc, j.number desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Journals" crumbs={[["Finance"], ["Journals"]]} sub="Every posting is a balanced journal that links back to its source document.">{ctx.perms.has("finance.journal") && <Link className="btn primary" href="/app/finance/journals/new">New manual journal</Link>}</PageHead>
    <Filters action="/app/finance/journals" q={q} status={status} statuses={["draft", "posted", "reversed"]} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No journals" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Journal</th><th>Date</th><th>Memo</th><th>Status</th><th className="num">Amount</th><th></th></tr></thead><tbody>
      {d.rows.map((j: any) => <tr key={j.id}><td data-label="Journal"><Link href={`/app/finance/journals/${j.id}`}>{j.number}</Link></td><td data-label="Date">{j.entry_date}</td><td data-label="Memo">{j.memo}</td><td data-label="Status"><Badge status={j.status} /></td><td data-label="Amount" className="num">{formatMoney(j.amount)}</td>
        <td>{j.status === "draft" && ctx.perms.has("finance.journal") && !ctx.readOnlyReason && <StatusButton className="btn sm" action={postJournalAction.bind(null, j.id)} label="Post" />}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/finance/journals" params={{ q, status }} /></div></>);
}
