import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { formatMoney } from "@/lib/money";
export default async function PortalInvoices() {
  const ctx = await requireTenant("portal.view"); const cid = ctx.membership.customerId!;
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select * from invoices where tenant_id=$1 and customer_id=$2 order by issue_date desc limit 100", [ctx.tenant.id, cid])).rows);
  return (<><PageHead title="Your invoices" /><div className="card flush">{rows.length === 0 ? <Empty title="No invoices yet" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead><tbody>{rows.map((r: any) => <tr key={r.id}><td data-label="Invoice">{r.number}</td><td data-label="Issued">{r.issue_date}</td><td data-label="Due">{r.due_date}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Total" className="num">{formatMoney(r.total_paise)}</td><td data-label="Balance" className="num">{formatMoney(r.total_paise - r.paid_paise - r.credited_paise)}</td></tr>)}</tbody></table></div>}</div><p className="small muted">To pay, use the bank details on your invoice and quote the invoice number.</p></>);
}
