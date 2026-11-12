import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { trialBalance } from "@/lib/erp/finance";
import { sp1, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";
export default async function BS({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("finance.view"); const sp = await searchParams; const asOf = /^\d{4}-\d{2}-\d{2}$/.test(sp1(sp.asof)) ? sp1(sp.asof) : new Date().toISOString().slice(0, 10);
  const rows = await withTenantSystem(ctx.tenant.id, (db) => trialBalance(db, ctx.tenant.id, asOf));
  const net = (r: any) => Number(r.debit) - Number(r.credit);
  const assets = rows.filter((r) => r.type === "asset" && net(r) !== 0), liab = rows.filter((r) => r.type === "liability" && net(r) !== 0), eq = rows.filter((r) => r.type === "equity" && net(r) !== 0);
  const profit = -rows.filter((r) => ["income", "expense"].includes(r.type)).reduce((s, r) => s + net(r), 0);
  const ta = assets.reduce((s, r) => s + net(r), 0), tl = liab.reduce((s, r) => s - net(r), 0), te = eq.reduce((s, r) => s - net(r), 0) + profit;
  return (<><PageHead title="Balance sheet" crumbs={[["Finance"], ["Balance sheet"]]} sub={`As of ${asOf}`} />
    <form className="toolbar" method="get"><div><label className="f" htmlFor="asof">As of</label><input id="asof" type="date" name="asof" defaultValue={asOf} /></div><button className="btn">Apply</button></form>
    <div className="card flush tablewrap"><table><tbody>
      <tr><th colSpan={2}>Assets</th></tr>{assets.map((r) => <tr key={r.id}><td>{r.code} — {r.name}</td><td className="num">{formatMoney(net(r))}</td></tr>)}<tr><td><strong>Total assets</strong></td><td className="num"><strong>{formatMoney(ta)}</strong></td></tr>
      <tr><th colSpan={2}>Liabilities</th></tr>{liab.map((r) => <tr key={r.id}><td>{r.code} — {r.name}</td><td className="num">{formatMoney(-net(r))}</td></tr>)}<tr><td><strong>Total liabilities</strong></td><td className="num"><strong>{formatMoney(tl)}</strong></td></tr>
      <tr><th colSpan={2}>Equity</th></tr>{eq.map((r) => <tr key={r.id}><td>{r.code} — {r.name}</td><td className="num">{formatMoney(-net(r))}</td></tr>)}<tr><td>Current-period earnings (income − expenses to date)</td><td className="num">{formatMoney(profit)}</td></tr><tr><td><strong>Total equity</strong></td><td className="num"><strong>{formatMoney(te)}</strong></td></tr>
      <tr><td><strong>Liabilities + equity</strong></td><td className="num"><strong>{formatMoney(tl + te)}</strong></td></tr></tbody></table></div>
    {ta !== tl + te && <p className="err">Assets and liabilities + equity differ by {formatMoney(ta - tl - te)} — contact support.</p>}</>);
}
