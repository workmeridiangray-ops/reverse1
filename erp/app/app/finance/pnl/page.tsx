import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { profitAndLoss } from "@/lib/erp/finance";
import { sp1, type SP } from "@/lib/list";
import { formatMoney } from "@/lib/money";
export default async function PnL({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("finance.view"); const sp = await searchParams; const now = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp1(sp.from)) ? sp1(sp.from) : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`; const to = /^\d{4}-\d{2}-\d{2}$/.test(sp1(sp.to)) ? sp1(sp.to) : now.toISOString().slice(0, 10);
  const rows = await withTenantSystem(ctx.tenant.id, (db) => profitAndLoss(db, ctx.tenant.id, from, to));
  const inc = rows.filter((r) => r.type === "income"), exp = rows.filter((r) => r.type === "expense");
  const ti = inc.reduce((s, r) => s + Number(r.net_credit), 0), te = exp.reduce((s, r) => s - Number(r.net_credit), 0);
  return (<><PageHead title="Profit and loss" crumbs={[["Finance"], ["Profit & loss"]]} sub="Cost basis: weighted-average cost, expensed as cost of goods sold at dispatch. Revenue is recognised at invoice." />
    <form className="toolbar" method="get"><div><label className="f" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} /></div><div><label className="f" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} /></div><button className="btn">Apply</button><a className="btn" href={`/app/export/pnl?from=${from}&to=${to}`}>Download CSV</a></form>
    <div className="card flush tablewrap"><table><tbody>
      <tr><th colSpan={2}>Income</th></tr>{inc.map((r) => <tr key={r.code}><td>{r.code} — {r.name}</td><td className="num">{formatMoney(r.net_credit)}</td></tr>)}<tr><td><strong>Total income</strong></td><td className="num"><strong>{formatMoney(ti)}</strong></td></tr>
      <tr><th colSpan={2}>Expenses</th></tr>{exp.map((r) => <tr key={r.code}><td>{r.code} — {r.name}</td><td className="num">{formatMoney(-Number(r.net_credit))}</td></tr>)}<tr><td><strong>Total expenses</strong></td><td className="num"><strong>{formatMoney(te)}</strong></td></tr>
      <tr><td><strong>Net profit</strong></td><td className="num"><strong style={{ color: ti - te < 0 ? "var(--bad)" : undefined }}>{formatMoney(ti - te)}</strong></td></tr></tbody></table></div></>);
}
