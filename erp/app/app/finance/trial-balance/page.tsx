import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Alert } from "@/components/ui";
import { trialBalance } from "@/lib/erp/finance";
import { sp1, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";
export default async function TB({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("finance.view"); const asOf = /^\d{4}-\d{2}-\d{2}$/.test(sp1((await searchParams).asof)) ? sp1((await searchParams).asof) : new Date().toISOString().slice(0, 10);
  const rows = (await withTenantSystem(ctx.tenant.id, (db) => trialBalance(db, ctx.tenant.id, asOf))).filter((r) => r.debit || r.credit);
  const td = rows.reduce((s, r) => s + Number(r.debit), 0), tc = rows.reduce((s, r) => s + Number(r.credit), 0);
  return (<><PageHead title="Trial balance" crumbs={[["Finance"], ["Trial balance"]]} sub={`As of ${asOf}. Data is live from the ledger.`} />
    <form className="toolbar" method="get"><div><label className="f" htmlFor="asof">As of</label><input id="asof" type="date" name="asof" defaultValue={asOf} /></div><button className="btn">Apply</button><a className="btn" href={`/app/export/trial-balance?asof=${asOf}`}>Download CSV</a></form>
    {td !== tc && <Alert tone="bad">The ledger does not balance (difference {formatMoney(td - tc)}). Contact support immediately.</Alert>}
    <div className="card flush tablewrap"><table><thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead><tbody>
      {rows.map((r) => { const net = Number(r.debit) - Number(r.credit); return <tr key={r.id}><td><Link href={`/app/finance/accounts/${r.id}`}>{r.code} — {r.name}</Link></td><td className="num">{net > 0 ? formatMoney(net) : ""}</td><td className="num">{net < 0 ? formatMoney(-net) : ""}</td></tr>; })}</tbody>
      <tfoot><tr><td>Total</td><td className="num">{formatMoney(rows.reduce((s, r) => s + Math.max(0, Number(r.debit) - Number(r.credit)), 0))}</td><td className="num">{formatMoney(rows.reduce((s, r) => s + Math.max(0, Number(r.credit) - Number(r.debit)), 0))}</td></tr></tfoot></table></div></>);
}
