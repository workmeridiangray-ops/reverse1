import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { confirmOrderAction, amendOrderAction, cancelOrderAction, raisePRAction } from "../../actions";
import { dispatchAction, requestReturnAction } from "../../../fulfilment/actions";
import { invoiceAction } from "../../../finance/actions";
import { formatMoney, formatQty, inputQty } from "@/lib/money";
import { creditExposure } from "@/lib/erp/sales";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("sales.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const o = (await db.query("select o.*, c.name customer, c.credit_limit_paise, b.name branch, w.name warehouse from sales_orders o join customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id join branches b on b.id=o.branch_id and b.tenant_id=o.tenant_id join warehouses w on w.id=o.warehouse_id and w.tenant_id=o.tenant_id where o.id=$1 and o.tenant_id=$2 and ($3::uuid[] is null or o.branch_id=any($3))", [id, ctx.tenant.id, ctx.membership.branchIds])).rows[0];
    if (!o) return null;
    return { o, lines: (await db.query("select l.*, i.name, i.sku, i.kind from sales_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.order_id=$1 order by line_no", [id])).rows,
      dispatches: (await db.query("select id, number, status, created_at, tracking_ref from dispatches where order_id=$1 order by created_at", [id])).rows,
      invoices: (await db.query("select id, number, status, total_paise from invoices where order_id=$1 order by created_at", [id])).rows,
      returns: (await db.query("select id, number, status, qty from customer_returns where order_id=$1", [id])).rows,
      prs: (await db.query("select id, number, status from purchase_requests where source_order_id=$1", [id])).rows,
      exposure: await creditExposure(db, ctx.tenant.id, o.customer_id, id) };
  });
  if (!d) notFound(); const { o } = d; const rw = !ctx.readOnlyReason;
  const live = ["confirmed", "partially_fulfilled"].includes(o.status);
  const short = d.lines.some((l: any) => l.kind === "goods" && l.qty > l.reserved_qty + l.dispatched_qty);
  const canDispatch = ctx.perms.has("inventory.post") && live && rw && d.lines.some((l: any) => l.reserved_qty > 0);
  const canInvoice = ctx.perms.has("finance.invoice") && !["draft", "cancelled", "credit_hold"].includes(o.status) && rw && d.lines.some((l: any) => (l.kind === "goods" ? l.dispatched_qty - l.returned_qty : l.qty) > l.invoiced_qty);
  return (<>
    <PageHead title={o.number} crumbs={[["Sales"], ["Orders", "/app/sales/orders"], [o.number]]} sub={<><Badge status={o.status} /> · {o.customer} · {o.branch} / {o.warehouse}</>}>
      {ctx.perms.has("sales.create") && rw && o.status === "draft" && <ActionForm action={confirmOrderAction.bind(null, id)} submit="Confirm & reserve stock" guard={false}>{null}</ActionForm>}
    </PageHead>
    {o.status === "credit_hold" && <Alert tone="bad"><strong>Credit hold.</strong> Customer limit {formatMoney(o.credit_limit_paise)}; open exposure {formatMoney(d.exposure.ar + d.exposure.open)} plus this order {formatMoney(o.total_paise)}. Nothing is reserved or dispatched until released.
      {ctx.perms.has("sales.credit_override") && rw ? <ActionForm action={confirmOrderAction.bind(null, id)} submit="Release with override" guard={false}><Field name="override_reason" label="Reason for override (recorded in audit trail)" required /></ActionForm> : <p>Ask a manager with override rights to release it.</p>}</Alert>}
    {o.credit_override_reason && <Alert tone="warn">Credit override reason: {o.credit_override_reason}</Alert>}
    {live && short && <Alert tone="warn">Some lines are short of stock. {ctx.perms.has("procurement.create") && rw && <StatusButton action={raisePRAction.bind(null, id)} label="Raise purchase request for shortage" />} Stock received later is allocated to this order automatically.</Alert>}
    <div className="card flush tablewrap"><table><thead><tr><th>#</th><th>Item</th><th className="num">Ordered</th><th className="num">Reserved</th><th className="num">Short</th><th className="num">Dispatched</th><th className="num">Invoiced</th><th className="num">Returned</th><th className="num">Total</th></tr></thead><tbody>
      {d.lines.map((l: any) => { const sh = l.kind === "goods" ? Math.max(0, l.qty - l.reserved_qty - l.dispatched_qty) : 0; return <tr key={l.id}><td>{l.line_no}</td><td>{l.sku} — {l.name}</td><td className="num">{formatQty(l.qty)}</td><td className="num">{formatQty(l.reserved_qty)}</td><td className="num">{sh > 0 ? <span className="badge warn">{formatQty(sh)}</span> : "—"}</td><td className="num">{formatQty(l.dispatched_qty)}</td><td className="num">{formatQty(l.invoiced_qty)}</td><td className="num">{formatQty(l.returned_qty)}</td><td className="num">{formatMoney(l.total_paise)}</td></tr>; })}</tbody>
      <tfoot><tr><td colSpan={8}>Order total (incl. tax {formatMoney(o.tax_paise)})</td><td className="num">{formatMoney(o.total_paise)}</td></tr></tfoot></table></div>
    {canDispatch && <details className="drawer"><summary>Dispatch goods</summary><div><p className="muted small">Only reserved stock can be dispatched. Enter what is leaving now; partial dispatch is fine.</p>
      <ActionForm action={dispatchAction.bind(null, id)} submit="Post dispatch"><div className="grid g2"><Field name="carrier" label="Carrier" /><Field name="tracking" label="Tracking / LR number" /></div>
        {d.lines.filter((l: any) => l.reserved_qty > 0).map((l: any) => <Field key={l.id} name={`qty_${l.id}`} label={`${l.name} — reserved ${formatQty(l.reserved_qty)}`} defaultValue={inputQty(l.reserved_qty)} />)}</ActionForm></div></details>}
    {canInvoice && <details className="drawer"><summary>Create invoice</summary><div><p className="muted small">Goods are invoiced after dispatch. Defaults show what is dispatched and not yet invoiced.</p>
      <ActionForm action={invoiceAction.bind(null, id)} submit="Post invoice"><Field name="issue_date" label="Invoice date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        {d.lines.filter((l: any) => (l.kind === "goods" ? l.dispatched_qty - l.returned_qty : l.qty) > l.invoiced_qty).map((l: any) => <Field key={l.id} name={`qty_${l.id}`} label={`${l.name} — can invoice ${formatQty((l.kind === "goods" ? l.dispatched_qty - l.returned_qty : l.qty) - l.invoiced_qty)}`} defaultValue={inputQty((l.kind === "goods" ? l.dispatched_qty - l.returned_qty : l.qty) - l.invoiced_qty)} />)}</ActionForm></div></details>}
    {ctx.perms.has("sales.create") && rw && ["confirmed", "credit_hold", "partially_fulfilled"].includes(o.status) && <details className="drawer"><summary>Amend quantities</summary><div>
      <p className="muted small">Reservations and shortages are recalculated. You can’t go below what was already dispatched. Fulfilled orders can’t be amended — use a return or a new order.</p>
      <ActionForm action={amendOrderAction.bind(null, id, o.row_version)} submit="Apply amendment">{d.lines.map((l: any) => <Field key={l.id} name={`qty_${l.id}`} label={`${l.name} (now ${formatQty(l.qty)}, dispatched ${formatQty(l.dispatched_qty)})`} defaultValue={inputQty(l.qty)} />)}<Field name="reason" label="Reason" required /></ActionForm></div></details>}
    {ctx.perms.has("sales.cancel") && rw && !["cancelled", "closed", "fulfilled"].includes(o.status) && <details className="drawer"><summary>Cancel {o.status === "partially_fulfilled" ? "remainder" : "order"}</summary><div>
      <ActionForm action={cancelOrderAction.bind(null, id)} submit={o.status === "partially_fulfilled" ? "Cancel undelivered remainder" : "Cancel order"} danger confirm="Cancel this order? Reservations are released and open purchase requests for it are withdrawn."><Field name="reason" label="Reason" required /></ActionForm></div></details>}
    <div className="grid g2">
      <div className="card"><h3>Dispatches</h3>{d.dispatches.length ? d.dispatches.map((x: any) => <p key={x.id}><Link href={`/app/fulfilment/dispatches/${x.id}`}>{x.number}</Link> <Badge status={x.status} /> {x.tracking_ref}</p>) : <p className="muted">None yet.</p>}</div>
      <div className="card"><h3>Invoices</h3>{d.invoices.length ? d.invoices.map((x: any) => <p key={x.id}><Link href={`/app/finance/invoices/${x.id}`}>{x.number}</Link> <Badge status={x.status} /> {formatMoney(x.total_paise)}</p>) : <p className="muted">None yet.</p>}</div>
      <div className="card"><h3>Purchase requests</h3>{d.prs.length ? d.prs.map((x: any) => <p key={x.id}><Link href={`/app/procurement/requests/${x.id}`}>{x.number}</Link> <Badge status={x.status} /></p>) : <p className="muted">None.</p>}</div>
      <div className="card"><h3>Returns</h3>{d.returns.length ? d.returns.map((x: any) => <p key={x.id}>{x.number} <Badge status={x.status} /> {formatQty(x.qty)}</p>) : <p className="muted">None.</p>}
        {ctx.perms.has("sales.create") && rw && d.lines.some((l: any) => l.dispatched_qty - l.returned_qty > 0) && <details><summary className="small">Request a return</summary>
          {d.lines.filter((l: any) => l.dispatched_qty - l.returned_qty > 0).map((l: any) => <ActionForm key={l.id} action={requestReturnAction.bind(null, l.id)} submit="Request return" resetOnSuccess><p className="small"><strong>{l.name}</strong> (dispatched {formatQty(l.dispatched_qty)})</p><div className="grid g2"><Field name="qty" label="Quantity" /><Field name="reason" label="Reason" /></div></ActionForm>)}</details>}</div>
    </div></>);
}
