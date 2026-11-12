import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { refundAction } from "../actions";
import { formatMoney } from "@/lib/money";
export default async function Payments() {
  const c = await requirePlatform("billing", "support");
  const d = await withSystem(async (db) => ({ pays: (await db.query("select p.*, t.name tname, i.number from platform_payments p join tenants t on t.id=p.tenant_id join platform_invoices i on i.id=p.invoice_id order by p.created_at desc limit 80")).rows, hooks: (await db.query("select * from webhook_events order by received_at desc limit 20")).rows,
    open: (await db.query("select i.*, t.name tname from platform_invoices i join tenants t on t.id=i.tenant_id where i.status in ('open','failed') and i.due_at < now() - interval '1 day' order by i.due_at limit 30")).rows }));
  const canRefund = c.user.platformRole === "owner" || c.user.platformRole === "billing";
  return (<><PageHead title="Payments & invoices" sub="Successful, pending, failed, disputed and refunded payments with provider reconciliation references." />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>When</th><th>Company</th><th>Invoice</th><th>Status</th><th className="num">Amount</th><th>Reconciliation ref</th><th></th></tr></thead><tbody>
      {d.pays.map((p: any) => <tr key={p.id}><td data-label="When">{new Date(p.created_at).toLocaleString("en-IN")}</td><td data-label="Company">{p.tname}</td><td data-label="Invoice">{p.number}</td><td data-label="Status"><Badge status={p.status} />{p.failure_reason && <span className="muted small"> {p.failure_reason}</span>}</td><td data-label="Amount" className="num">{formatMoney(p.amount_paise)}</td><td data-label="Ref" className="small">{p.reconciliation_ref ?? p.provider_payment_id}</td>
        <td>{canRefund && p.status === "succeeded" && <details><summary className="btn sm">Refund</summary><ActionForm action={refundAction.bind(null, p.id)} submit="Record refund" danger><Field name="reason" label="Reason" required /><p className="small muted">Issue the refund in the provider dashboard; this records it in Ledgerline.</p></ActionForm></details>}</td></tr>)}</tbody></table></div>
    <div className="card"><h2>Overdue unpaid invoices</h2>{d.open.length === 0 ? <p className="muted">None.</p> : d.open.map((i: any) => <p key={i.id}>{i.tname} · {i.number} · {formatMoney(i.total_paise)} · due {new Date(i.due_at).toLocaleDateString("en-IN")}</p>)}</div>
    <div className="card"><h2>Recent provider events</h2>{d.hooks.map((h: any) => <p key={h.id} className="small">{new Date(h.received_at).toLocaleString("en-IN")} · {h.provider} · {h.event_id} · <Badge status={h.status === "processed" ? "done" : h.status} label={h.status} />{h.error && ` ${h.error}`}</p>)}</div></>);
}
