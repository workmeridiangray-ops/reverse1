import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { supplierPerformance } from "@/lib/erp/procurement";
import { formatQty } from "@/lib/money";
export default async function Perf() {
  const ctx = await requireTenant("procurement.view");
  const rows = await withTenantSystem(ctx.tenant.id, (db) => supplierPerformance(db, ctx.tenant.id));
  return (<><PageHead title="Supplier performance" crumbs={[["Purchasing"], ["Performance"]]} sub="Fill rate = received ÷ ordered quantity on non-cancelled orders. Return rate = returned ÷ received." />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>Supplier</th><th className="num">Orders</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Fill rate</th><th className="num">Return rate</th></tr></thead><tbody>
      {rows.map((r: any) => <tr key={r.id}><td data-label="Supplier">{r.name}</td><td data-label="Orders" className="num">{r.orders}</td><td data-label="Ordered" className="num">{formatQty(r.ordered)}</td><td data-label="Received" className="num">{formatQty(r.received)}</td><td data-label="Fill rate" className="num">{r.fill_rate ?? "—"}{r.fill_rate && "%"}</td><td data-label="Return rate" className="num">{r.return_rate ?? "—"}{r.return_rate && "%"}</td></tr>)}</tbody></table></div></>);
}
