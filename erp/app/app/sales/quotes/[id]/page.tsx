import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { LineGrid } from "@/components/LineGrid";
import { itemOptions, warehousesFor } from "@/lib/erp/opts";
import { submitQuoteAction, acceptQuoteAction, reviseQuoteAction } from "../../actions";
import { formatMoney, formatQty, inputQty, inputMoney } from "@/lib/money";

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("sales.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const q = (await db.query("select q.*, c.name customer, b.name branch from quotes q join customers c on c.id=q.customer_id and c.tenant_id=q.tenant_id join branches b on b.id=q.branch_id and b.tenant_id=q.tenant_id where q.id=$1 and q.tenant_id=$2 and ($3::uuid[] is null or q.branch_id=any($3))", [id, ctx.tenant.id, ctx.membership.branchIds])).rows[0];
    if (!q) return null;
    return { q, lines: (await db.query("select l.*, i.name, i.sku from quote_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.quote_id=$1 order by line_no", [id])).rows,
      versions: (await db.query("select id, number, status, version from quotes where root_id=$1 order by version", [q.root_id])).rows, items: await itemOptions(db, ctx.tenant.id, "sale"), whs: await warehousesFor(db, ctx.tenant.id, ctx.membership.branchIds),
      approval: (await db.query("select status, reason from approval_requests where entity_type='quote' and entity_id=$1 order by created_at desc limit 1", [id])).rows[0],
      order: (await db.query("select id, number from sales_orders where quote_id=$1", [id])).rows[0] };
  });
  if (!d) notFound(); const { q } = d; const can = ctx.perms.has("sales.create") && !ctx.readOnlyReason;
  return (<><PageHead title={q.number} crumbs={[["Sales"], ["Quotations", "/app/sales/quotes"], [q.number]]} sub={<><Badge status={q.status} /> · {q.customer} · {q.branch}</>}>
      {can && q.status === "draft" && <StatusButton className="btn primary" action={submitQuoteAction.bind(null, id)} label="Submit" />}</PageHead>
    {d.approval?.status === "rejected" && <Alert tone="bad">Rejected: {d.approval.reason}. Revise the quotation to resubmit.</Alert>}
    {q.status === "pending_approval" && <Alert tone="info">Waiting for approval. Approvers can see the total and terms in their approval inbox.</Alert>}
    {d.order && <Alert tone="ok">Accepted — order <Link href={`/app/sales/orders/${d.order.id}`}>{d.order.number}</Link> created at these prices.</Alert>}
    <div className="card flush tablewrap"><table><thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Price</th><th className="num">Disc</th><th className="num">Net</th><th className="num">Tax</th><th className="num">Total</th></tr></thead><tbody>
      {d.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td>{l.sku} — {l.name}</td><td className="num">{formatQty(Math.round(l.qty * 1000 / Number(l.uom_factor_milli)))}</td><td>{l.uom}</td><td className="num">{formatMoney(l.unit_price_paise)}</td><td className="num">{l.discount_bps / 100}%</td><td className="num">{formatMoney(l.net_paise)}</td><td className="num">{formatMoney(l.tax_paise)}</td><td className="num">{formatMoney(l.total_paise)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={6}>Totals</td><td className="num">{formatMoney(q.subtotal_paise)}</td><td className="num">{formatMoney(q.tax_paise)}</td><td className="num">{formatMoney(q.total_paise)}</td></tr></tfoot></table></div>
    {d.versions.length > 1 && <div className="card"><h3>Versions</h3><p>{d.versions.map((v: any) => <span key={v.id} style={{ marginRight: 12 }}>{v.id === id ? <strong>{v.number}</strong> : <Link href={`/app/sales/quotes/${v.id}`}>{v.number}</Link>} <Badge status={v.status} /></span>)}</p></div>}
    {can && q.status === "approved" && <div className="card"><h2>Customer accepted?</h2><p className="muted">Creates a sales order at exactly these prices. Stock is reserved when you confirm the order.</p>
      <ActionForm action={acceptQuoteAction.bind(null, id)} submit="Accept and create order"><Field name="warehouse_id" label="Fulfil from warehouse" type="select" required>{d.whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Field></ActionForm></div>}
    {can && ["draft", "approved", "rejected", "pending_approval", "expired"].includes(q.status) && <details className="drawer"><summary>Revise as a new version</summary><div>
      <ActionForm action={reviseQuoteAction.bind(null, id)} submit="Save as new version"><Field name="notes" label="Notes" type="textarea" defaultValue={q.notes ?? ""} />
        <LineGrid mode="sale" items={d.items} initial={d.lines.map((l: any) => ({ itemId: l.item_id, qty: inputQty(Math.round(l.qty * 1000 / Number(l.uom_factor_milli))), uom: l.uom === d.items.find((i) => i.id === l.item_id)?.unit ? "" : l.uom, price: inputMoney(l.unit_price_paise), disc: String(l.discount_bps / 100) }))} /></ActionForm></div></details>}
  </>);
}
