import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { formatMoney } from "@/lib/money";
export default async function Margin() {
  const ctx = await requireTenant("finance.view");
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query(
    `select i.sku, i.name, coalesce(sum(il.net_paise),0) revenue,
            coalesce((select sum(dl.qty * dl.unit_cost_paise / 1000) from dispatch_lines dl where dl.tenant_id=i.tenant_id and dl.item_id=i.id),0)::bigint cost
       from items i left join invoice_lines il on il.item_id=i.id and il.tenant_id=i.tenant_id left join invoices v on v.id=il.invoice_id and v.status <> 'void'
      where i.tenant_id=$1 and i.kind='goods' group by i.id having coalesce(sum(il.net_paise),0) > 0 order by revenue desc`, [ctx.tenant.id])).rows);
  return (<><PageHead title="Sales margin" crumbs={[["Reports"], ["Margin"]]} sub="Basis: invoiced net revenue vs weighted-average cost of goods dispatched. Returns/credit notes are not netted here; see Profit & loss for the ledger view." />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>Item</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Margin</th><th className="num">%</th></tr></thead><tbody>
      {rows.map((r: any) => <tr key={r.sku}><td data-label="Item">{r.sku} — {r.name}</td><td data-label="Revenue" className="num">{formatMoney(r.revenue)}</td><td data-label="Cost" className="num">{formatMoney(r.cost)}</td><td data-label="Margin" className="num">{formatMoney(r.revenue - r.cost)}</td><td data-label="%" className="num">{r.revenue ? (((r.revenue - r.cost) * 100) / r.revenue).toFixed(1) : "—"}%</td></tr>)}</tbody></table></div></>);
}
