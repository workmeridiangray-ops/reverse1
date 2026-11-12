import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { receivablesAgeing } from "@/lib/erp/finance";
import { formatMoney } from "@/lib/money";
export default async function Ageing() {
  const ctx = await requireTenant("finance.view"); const asOf = new Date().toISOString().slice(0, 10);
  const rows = await withTenantSystem(ctx.tenant.id, (db) => receivablesAgeing(db, ctx.tenant.id, asOf));
  const tot = (k: string) => rows.reduce((s: number, r: any) => s + Number(r[k]), 0);
  return (<><PageHead title="Receivables ageing" crumbs={[["Reports"], ["Ageing"]]} sub={`As of ${asOf}, by days past due date.`}>{ctx.perms.has("reports.export") && <a className="btn" href="/app/export/ageing">Download CSV</a>}</PageHead>
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>Customer</th><th className="num">Current</th><th className="num">1–30</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">90+</th><th className="num">Total</th></tr></thead><tbody>
      {rows.map((r: any) => <tr key={r.customer_id}><td data-label="Customer"><Link href={`/app/finance/invoices?q=${encodeURIComponent(r.name)}`}>{r.name}</Link></td>{["current_amt", "d1_30", "d31_60", "d61_90", "d90_plus", "total"].map((k) => <td key={k} data-label={k} className="num">{formatMoney(r[k])}</td>)}</tr>)}</tbody>
      <tfoot><tr><td>Total</td>{["current_amt", "d1_30", "d31_60", "d61_90", "d90_plus", "total"].map((k) => <td key={k} className="num">{formatMoney(tot(k))}</td>)}</tr></tfoot></table></div></>);
}
