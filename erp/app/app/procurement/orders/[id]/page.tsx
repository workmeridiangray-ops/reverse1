import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { submitPOAction, sendPOAction, ackPOAction, cancelPOAction, receiveAction, supplierReturnAction, billAction } from "../../actions";
import { formatMoney, formatQty, inputQty, inputMoney } from "@/lib/money";
export default async function PODetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("procurement.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const p = (await db.query("select p.*, s.name supplier, s.doc_expiry_on, w.name warehouse from purchase_orders p join suppliers s on s.id=p.supplier_id and s.tenant_id=p.tenant_id join warehouses w on w.id=p.warehouse_id and w.tenant_id=p.tenant_id where p.id=$1 and p.tenant_id=$2 and ($3::uuid[] is null or p.branch_id=any($3))", [id, ctx.tenant.id, ctx.membership.branchIds])).rows[0];
    if (!p) return null;
    return { p, lines: (await db.query("select l.*, i.sku, i.name from purchase_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.order_id=$1 order by line_no", [id])).rows,
      grns: (await db.query("select id, number, created_at, supplier_delivery_ref from goods_receipts where order_id=$1 order by created_at", [id])).rows, bills: (await db.query("select id, number, status, total_paise, supplier_ref from supplier_bills where order_id=$1 order by created_at", [id])).rows,
      appr: (await db.query("select status, reason from approval_requests where entity_type='purchase_order' and entity_id=$1 order by created_at desc limit 1", [id])).rows[0] };
  });
  if (!d) notFound(); const { p } = d; const rw = !ctx.readOnlyReason; const canC = ctx.perms.has("procurement.create") && rw;
  const receivable = ["approved", "sent", "acknowledged", "partially_received"].includes(p.status) && ctx.perms.has("procurement.receive") && rw;
  const billable = d.lines.some((l: any) => l.received_qty - l.returned_qty > l.billed_qty) && ctx.perms.has("finance.invoice") && rw;
  return (<><PageHead title={p.number} crumbs={[["Purchasing"], ["Orders", "/app/procurement/orders"], [p.number]]} sub={<><Badge status={p.status} /> · {p.supplier} · into {p.warehouse}</>}>
      {canC && p.status === "draft" && <StatusButton className="btn primary" action={submitPOAction.bind(null, id)} label="Submit" />}
      {canC && p.status === "approved" && <StatusButton className="btn primary" action={sendPOAction.bind(null, id)} label="Mark sent to supplier" />}</PageHead>
    {p.status === "draft" && d.appr?.status === "rejected" && <Alert tone="bad">Approval was rejected: {d.appr.reason}. Edit by creating a corrected order or ask the approver to reconsider.</Alert>}
    {p.status === "pending_approval" && <Alert tone="info">Waiting for approval; goods can’t be received until it is approved.</Alert>}
    {p.supplier_ack_ref && <p className="muted">Supplier acknowledgement: {p.supplier_ack_ref}</p>}
    <div className="card flush tablewrap"><table><thead><tr><th>#</th><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Returned</th><th className="num">Billed</th><th className="num">Outstanding</th><th className="num">Unit cost</th><th className="num">Total</th></tr></thead><tbody>
      {d.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td>{l.sku} — {l.name}</td><td className="num">{formatQty(l.qty)}</td><td className="num">{formatQty(l.received_qty)}</td><td className="num">{formatQty(l.returned_qty)}</td><td className="num">{formatQty(l.billed_qty)}</td><td className="num">{l.qty - l.received_qty > 0 ? <span className="badge warn">{formatQty(l.qty - l.received_qty)}</span> : "—"}</td><td className="num">{formatMoney(l.unit_cost_paise)}/{l.uom}</td><td className="num">{formatMoney(l.total_paise)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={8}>Total incl. tax {formatMoney(p.tax_paise)}</td><td className="num">{formatMoney(p.total_paise)}</td></tr></tfoot></table></div>
    {canC && p.status === "sent" && <details className="drawer"><summary>Record supplier acknowledgement</summary><div><ActionForm action={ackPOAction.bind(null, id)} submit="Save acknowledgement"><div className="grid g2"><Field name="ref" label="Supplier reference" required /><Field name="expected_date" label="Confirmed delivery date" type="date" /></div></ActionForm></div></details>}
    {receivable && <details className="drawer" open><summary>Receive goods</summary><div><p className="muted small">Partial receipts are fine. You can’t receive more than is outstanding.</p>
      <ActionForm action={receiveAction.bind(null, id)} submit="Post goods receipt"><Field name="delivery_ref" label="Supplier delivery note no." />
        {d.lines.filter((l: any) => l.qty > l.received_qty).map((l: any) => <Field key={l.id} name={`qty_${l.id}`} label={`${l.name} — outstanding ${formatQty(l.qty - l.received_qty)}`} defaultValue={inputQty(l.qty - l.received_qty)} />)}</ActionForm></div></details>}
    {billable && <details className="drawer"><summary>Enter supplier invoice (three-way match)</summary><div><p className="muted small">Ordered, received and billed quantities and prices are compared. Differences beyond tolerance (price 2%, quantity 0%) are held for approval.</p>
      <ActionForm action={billAction.bind(null, id)} submit="Record bill"><div className="grid g3"><Field name="supplier_ref" label="Supplier invoice no." required /><Field name="bill_date" label="Invoice date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field name="due_date" label="Due date (optional)" type="date" /></div>
        {d.lines.filter((l: any) => l.received_qty - l.returned_qty > l.billed_qty).map((l: any) => <div className="grid g2" key={l.id}><Field name={`qty_${l.id}`} label={`${l.name} — qty to bill (max ${formatQty(l.received_qty - l.returned_qty - l.billed_qty)})`} defaultValue={inputQty(l.received_qty - l.returned_qty - l.billed_qty)} /><Field name={`cost_${l.id}`} label={`Unit cost on supplier invoice (PO: ${formatMoney(l.unit_cost_paise)}/${l.uom})`} defaultValue={inputMoney(l.unit_cost_paise)} /></div>)}</ActionForm></div></details>}
    {ctx.perms.has("procurement.receive") && rw && d.lines.some((l: any) => l.received_qty - l.returned_qty - l.billed_qty > 0) && <details className="drawer"><summary>Return goods to supplier</summary><div>
      {d.lines.filter((l: any) => l.received_qty - l.returned_qty - l.billed_qty > 0).map((l: any) => <ActionForm key={l.id} action={supplierReturnAction.bind(null, l.id)} submit="Post return" resetOnSuccess><p className="small"><strong>{l.name}</strong> — returnable {formatQty(l.received_qty - l.returned_qty - l.billed_qty)}</p><div className="grid g2"><Field name="qty" label="Quantity" /><Field name="reason" label="Reason" /></div></ActionForm>)}</div></details>}
    {ctx.perms.has("procurement.approve") && rw && ["draft", "pending_approval", "approved", "sent", "acknowledged"].includes(p.status) && <details className="drawer"><summary>Cancel order</summary><div><ActionForm action={cancelPOAction.bind(null, id)} submit="Cancel order" danger confirm="Cancel this purchase order?"><Field name="reason" label="Reason" required /></ActionForm></div></details>}
    <div className="grid g2"><div className="card"><h3>Goods receipts</h3>{d.grns.length ? d.grns.map((g: any) => <p key={g.id}>{g.number} · {new Date(g.created_at).toLocaleDateString("en-IN")} {g.supplier_delivery_ref && `· ${g.supplier_delivery_ref}`}</p>) : <p className="muted">None yet.</p>}</div>
      <div className="card"><h3>Supplier bills</h3>{d.bills.length ? d.bills.map((b: any) => <p key={b.id}><Link href={`/app/procurement/bills/${b.id}`}>{b.number}</Link> ({b.supplier_ref}) <Badge status={b.status} /> {formatMoney(b.total_paise)}</p>) : <p className="muted">None yet.</p>}</div></div></>);
}
