import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { formatMoney } from "@/lib/money";
export default async function Cash() {
  const ctx = await requireTenant("finance.view");
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query(
    `select to_char(j.entry_date,'YYYY-MM') m, sum(l.debit_paise) inflow, sum(l.credit_paise) outflow from journal_lines l join journals j on j.id=l.journal_id and j.tenant_id=l.tenant_id join accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id
      where l.tenant_id=$1 and a.system_key='cash' and j.status in ('posted','reversed') group by 1 order by 1 desc limit 24`, [ctx.tenant.id])).rows);
  return (<><PageHead title="Cash summary" crumbs={[["Reports"], ["Cash"]]} sub="Movements on the cash and bank account, by month." />
    <div className="card flush tablewrap"><table><thead><tr><th>Month</th><th className="num">In</th><th className="num">Out</th><th className="num">Net</th></tr></thead><tbody>{rows.map((r: any) => <tr key={r.m}><td>{r.m}</td><td className="num">{formatMoney(r.inflow)}</td><td className="num">{formatMoney(r.outflow)}</td><td className="num">{formatMoney(r.inflow - r.outflow)}</td></tr>)}</tbody></table></div></>);
}
