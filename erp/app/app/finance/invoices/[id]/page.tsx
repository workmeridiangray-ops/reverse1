import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { PrintButton } from "@/components/PrintButton";
import { creditNoteAction, refundAction } from "../../actions";
import { formatMoney, formatQty } from "@/lib/money";
export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("finance.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const i = (await db.query("select i.*, c.name customer, c.billing_address, c.gstin cgstin, b.name branch, o.number order_no, o.id oid from invoices i join customers c on c.id=i.customer_id and c.tenant_id=i.tenant_id join branches b on b.id=i.branch_id and b.tenant_id=i.tenant_id left join sales_orders o on o.id=i.order_id and o.tenant_id=i.tenant_id where i.id=$1 and i.tenant_id=$2 and ($3::uuid[] is null or i.branch_id=any($3))", [id, ctx.tenant.id, ctx.membership.branchIds])).rows[0];
    if (!i) return null;
    return { i, lines: (await db.query("select * from invoice_lines where invoice_id=$1", [id])).rows, cns: (await db.query("select * from credit_notes where invoice_id=$1 order by created_at", [id])).rows,
      pays: (await db.query("select r.number, a.amount_paise, r.received_on, r.method from receipt_allocations a join receipts r on r.id=a.receipt_id and r.tenant_id=a.tenant_id where a.invoice_id=$1 and r.status='posted'", [id])).rows, tenant: (await db.query("select legal_name, gstin, address from tenants where id=$1", [ctx.tenant.id])).rows[0] };
  });
  if (!d) notFound(); const { i } = d; const bal = i.total_paise - i.paid_paise - i.credited_paise; const rw = !ctx.readOnlyReason;
  return (<><PageHead title={`Invoice ${i.number}`} crumbs={[["Finance"], ["Invoices", "/app/finance/invoices"], [i.number]]} sub={<Badge status={i.status} />}><PrintButton /></PageHead>
    <div className="card"><div className="grid g2"><div><strong>{d.tenant.legal_name}</strong><br />{d.tenant.address}<br />{d.tenant.gstin && `GSTIN ${d.tenant.gstin}`}</div><div><strong>Bill to</strong><br />{i.customer}<br />{i.billing_address}<br />{i.cgstin && `GSTIN ${i.cgstin}`}</div></div>
      <dl className="kv" style={{ marginTop: 16 }}><dt>Issued</dt><dd>{i.issue_date}</dd><dt>Due</dt><dd>{i.due_date}</dd><dt>Branch</dt><dd>{i.branch}</dd>{i.order_no && <><dt>Order</dt><dd><Link href={`/app/sales/orders/${i.oid}`}>{i.order_no}</Link></dd></>}</dl></div>
    <div className="card flush tablewrap"><table><thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Disc</th><th className="num">Taxable</th><th className="num">Tax</th><th className="num">Amount</th></tr></thead><tbody>
      {d.lines.map((l: any) => <tr key={l.id}><td>{l.description}</td><td className="num">{formatQty(l.qty)}</td><td className="num">{formatMoney(l.unit_price_paise)}</td><td className="num">{l.discount_bps / 100}%</td><td className="num">{formatMoney(l.net_paise)}</td><td className="num">{formatMoney(l.tax_paise)} <span className="small muted">({l.tax_bps / 100}%)</span></td><td className="num">{formatMoney(l.total_paise)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={4}>Total</td><td className="num">{formatMoney(i.subtotal_paise)}</td><td className="num">{formatMoney(i.tax_paise)}</td><td className="num">{formatMoney(i.total_paise)}</td></tr>
        <tr><td colSpan={6}>Paid</td><td className="num">{formatMoney(i.paid_paise)}</td></tr><tr><td colSpan={6}>Credited</td><td className="num">{formatMoney(i.credited_paise)}</td></tr><tr><td colSpan={6}>Balance due</td><td className="num">{formatMoney(bal)}</td></tr></tfoot></table></div>
    {d.pays.length > 0 && <div className="card"><h3>Collections</h3>{d.pays.map((p: any, k: number) => <p key={k}>{p.number} · {p.received_on} · {p.method} · {formatMoney(p.amount_paise)}</p>)}</div>}
    {d.cns.length > 0 && <div className="card"><h3>Credit notes</h3>{d.cns.map((c: any) => <div key={c.id}><p>{c.number} · {formatMoney(c.net_paise + c.tax_paise)} · {c.reason}{c.refund_due_paise > 0 && <> · refund due {formatMoney(c.refund_due_paise - c.refunded_paise)}</>}</p>
      {c.refund_due_paise - c.refunded_paise > 0 && ctx.perms.has("finance.receipts") && rw && <ActionForm action={refundAction.bind(null, c.id)} submit="Record refund paid"><div className="grid g2"><Field name="amount" label="Amount (₹)" defaultValue={((c.refund_due_paise - c.refunded_paise) / 100).toFixed(2)} /><Field name="method" label="Paid from" type="select"><option value="bank">Bank</option><option value="cash">Cash</option></Field></div></ActionForm>}</div>)}</div>}
    {ctx.perms.has("finance.invoice") && rw && i.status !== "void" && <details className="drawer no-print"><summary>Issue a credit note</summary><div><p className="muted small">Reduces what the customer owes. For returned goods use the order’s return flow so stock is corrected too.</p>
      <ActionForm action={creditNoteAction.bind(null, id)} submit="Issue credit note"><div className="grid g2"><Field name="net" label="Amount before tax (₹)" required /><Field name="tax" label="Tax on it (₹)" /></div><Field name="reason" label="Reason" required /></ActionForm></div></details>}</>);
}
