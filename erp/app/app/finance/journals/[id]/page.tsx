import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { reverseJournalAction } from "../../actions";
import { sourceLink } from "@/lib/erp/links";
import { formatMoney } from "@/lib/money";
export default async function JournalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("finance.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const j = (await db.query("select * from journals where id=$1 and tenant_id=$2", [id, ctx.tenant.id])).rows[0]; if (!j) return null;
    return { j, lines: (await db.query("select l.*, a.code, a.name from journal_lines l join accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id where l.journal_id=$1 order by l.debit_paise desc", [id])).rows,
      rev: (await db.query("select id, number from journals where tenant_id=$1 and reverses_id=$2", [ctx.tenant.id, id])).rows[0], orig: j.reverses_id ? (await db.query("select id, number from journals where id=$1", [j.reverses_id])).rows[0] : null };
  });
  if (!d) notFound(); const { j } = d; const src = sourceLink(j.source_type, j.source_id);
  const dr = d.lines.reduce((s: number, l: any) => s + l.debit_paise, 0), cr = d.lines.reduce((s: number, l: any) => s + l.credit_paise, 0);
  return (<><PageHead title={j.number} crumbs={[["Finance"], ["Journals", "/app/finance/journals"], [j.number]]} sub={<><Badge status={j.status} /> · {j.entry_date} · {j.memo}</>} />
    <div className="card"><dl className="kv"><dt>Source</dt><dd>{src ? <Link href={src}>{j.source_type.replace("_", " ")}</Link> : j.source_type ?? "Manual journal"}</dd>{d.orig && <><dt>Reverses</dt><dd><Link href={`/app/finance/journals/${d.orig.id}`}>{d.orig.number}</Link> — {j.reversal_reason}</dd></>}{d.rev && <><dt>Reversed by</dt><dd><Link href={`/app/finance/journals/${d.rev.id}`}>{d.rev.number}</Link></dd></>}</dl></div>
    <div className="card flush tablewrap"><table><thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead><tbody>{d.lines.map((l: any) => <tr key={l.id}><td><Link href={`/app/finance/accounts/${l.account_id}`}>{l.code} — {l.name}</Link></td><td className="num">{l.debit_paise ? formatMoney(l.debit_paise) : ""}</td><td className="num">{l.credit_paise ? formatMoney(l.credit_paise) : ""}</td></tr>)}</tbody>
      <tfoot><tr><td>Total</td><td className="num">{formatMoney(dr)}</td><td className="num">{formatMoney(cr)}</td></tr></tfoot></table></div>
    {j.status === "posted" && ctx.perms.has("finance.reverse") && !ctx.readOnlyReason && <details className="drawer"><summary>Reverse this entry</summary><div><p className="muted small">Posts an opposite entry today. The original stays visible and cannot be edited. Linked documents (invoices, receipts) are not reopened by reversing their journal directly — use their own reverse/credit actions.</p>
      <ActionForm action={reverseJournalAction.bind(null, id)} submit="Post reversal" danger confirm="Post a reversing entry?"><Field name="reason" label="Reason (required)" required /></ActionForm></div></details>}</>);
}
