import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { formatMoney } from "@/lib/money";
export default async function PortalOrders() {
  const ctx = await requireTenant("portal.view"); const cid = ctx.membership.customerId!;
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select o.number, o.status, o.order_date, o.promised_date, o.total_paise, (select string_agg(d.tracking_ref, ', ') from dispatches d where d.order_id=o.id and d.tracking_ref is not null) tracking from sales_orders o where o.tenant_id=$1 and o.customer_id=$2 and o.status <> 'draft' order by o.created_at desc limit 100", [ctx.tenant.id, cid])).rows);
  return (<><PageHead title="Your orders" /><div className="card flush">{rows.length === 0 ? <Empty title="No orders yet" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Order</th><th>Date</th><th>Promised</th><th>Status</th><th>Tracking</th><th className="num">Total</th></tr></thead><tbody>{rows.map((r: any) => <tr key={r.number}><td data-label="Order">{r.number}</td><td data-label="Date">{r.order_date}</td><td data-label="Promised">{r.promised_date ?? "—"}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Tracking">{r.tracking ?? "—"}</td><td data-label="Total" className="num">{formatMoney(r.total_paise)}</td></tr>)}</tbody></table></div>}</div></>);
}
