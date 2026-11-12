import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { payBillAction } from "../../actions";
import { formatMoney, formatQty } from "@/lib/money";
export default async function BillDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("procurement.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const b = (await db.query("select b.*, s.name supplier, p.number po_no from supplier_bills b join suppliers s on s.id=b.supplier_id and s.tenant_id=b.tenant_id left join purchase_orders p on p.id=b.order_id and p.tenant_id=b.tenant_id where b.id=$1 and b.tenant_id=$2", [id, ctx.tenant.id])).rows[0];
    if (!b) return null;
    return { b, lines: (await db.query("select l.*, i.name from supplier_bill_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.bill_id=$1", [id])).rows, pays: (await db.query("select * from supplier_payments where bill_id=$1 order by created_at", [id])).rows,
      appr: (await db.query("select id, status, reason from approval_requests where entity_type='supplier_bill' and entity_id=$1 order by created_at desc limit 1", [id])).rows[0] };
  });
  if (!d) notFound(); const { b } = d; const detail: any[] = b.match_detail ?? [];
  return (<><PageHead title={b.number} crumbs={[["Purchasing"], ["Bills", "/app/procurement/bills"], [b.number]]} sub={<><Badge status={b.status} /> · {b.supplier} · invoice {b.supplier_ref}</>} />
    {b.status === "exception" && <Alert tone="warn"><strong>Held for approval.</strong> The bill differs from the order or receipt beyond tolerance. {ctx.perms.has("approvals.decide") ? <>Decide it in the <Link href="/app/approvals">approval inbox</Link>.</> : "A finance approver must decide it."}</Alert>}
    {b.status === "void" && <Alert tone="bad">This bill was rejected{d.appr?.reason ? `: ${d.appr.reason}` : ""}. Ask the supplier for a corrected invoice.</Alert>}
    <div className="card"><h2>Three-way match</h2><div className="tablewrap"><table><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Billed</th><th className="num">PO cost</th><th className="num">Invoice cost</th><th>Result</th></tr></thead><tbody>
      {detail.map((m, i) => <tr key={i}><td>{m.item}</td><td className="num">{formatQty(m.agreedQty)}</td><td className="num">{formatQty(m.receivedQty)}</td><td className="num">{formatQty(m.billedQty)}</td><td className="num">{formatMoney(m.poCost)}</td><td className="num">{formatMoney(m.billCost)}</td><td>{m.issues?.length ? <span className="badge bad">{m.issues.join("; ")}</span> : <span className="badge ok">within tolerance</span>}</td></tr>)}</tbody></table></div></div>
    <div className="card"><dl className="kv"><dt>Subtotal</dt><dd>{formatMoney(b.subtotal_paise)}</dd><dt>Input tax</dt><dd>{formatMoney(b.tax_paise)}</dd><dt>Total</dt><dd><strong>{formatMoney(b.total_paise)}</strong></dd><dt>Paid</dt><dd>{formatMoney(b.paid_paise)}</dd><dt>Balance</dt><dd>{formatMoney(b.total_paise - b.paid_paise)}</dd><dt>Due</dt><dd>{b.due_date}</dd>{b.po_no && <><dt>Purchase order</dt><dd>{b.po_no}</dd></>}</dl></div>
    {d.pays.length > 0 && <div className="card"><h3>Payments</h3>{d.pays.map((p: any) => <p key={p.id}>{p.number} · {p.paid_on} · {p.method} · {formatMoney(p.amount_paise)} {p.reference && `· ${p.reference}`}</p>)}</div>}
    {["posted", "partially_paid"].includes(b.status) && ctx.perms.has("finance.receipts") && !ctx.readOnlyReason && <div className="card"><h2>Record payment</h2><ActionForm action={payBillAction.bind(null, id)} submit="Record payment"><div className="grid g3"><Field name="amount" label="Amount (₹)" defaultValue={((b.total_paise - b.paid_paise) / 100).toFixed(2)} required /><Field name="method" label="Method" type="select"><option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option></Field><Field name="paid_on" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div><Field name="reference" label="Reference / UTR" /></ActionForm></div>}</>);
}
