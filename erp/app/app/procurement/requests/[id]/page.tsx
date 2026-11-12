import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { submitPRAction, convertPRAction } from "../../actions";
import { warehousesFor, suppliersList } from "@/lib/erp/opts";
import { formatQty, formatMoney } from "@/lib/money";
export default async function PRDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("procurement.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const r = (await db.query("select r.*, o.number order_no, o.id oid from purchase_requests r left join sales_orders o on o.id=r.source_order_id and o.tenant_id=r.tenant_id where r.id=$1 and r.tenant_id=$2 and ($3::uuid[] is null or r.branch_id=any($3))", [id, ctx.tenant.id, ctx.membership.branchIds])).rows[0];
    if (!r) return null;
    return { r, lines: (await db.query("select l.*, i.sku, i.name, s.name supplier from purchase_request_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id left join suppliers s on s.id=l.supplier_id and s.tenant_id=l.tenant_id where l.request_id=$1", [id])).rows,
      whs: await warehousesFor(db, ctx.tenant.id, ctx.membership.branchIds), sups: await suppliersList(db, ctx.tenant.id),
      pos: (await db.query("select id, number from purchase_orders where request_id=$1", [id])).rows, appr: (await db.query("select status, reason from approval_requests where entity_type='purchase_request' and entity_id=$1 order by created_at desc limit 1", [id])).rows[0] };
  });
  if (!d) notFound(); const { r } = d; const can = ctx.perms.has("procurement.create") && !ctx.readOnlyReason;
  return (<><PageHead title={r.number} crumbs={[["Purchasing"], ["Requests", "/app/procurement/requests"], [r.number]]} sub={<><Badge status={r.status} />{r.order_no && <> · for order <Link href={`/app/sales/orders/${r.oid}`}>{r.order_no}</Link></>}</>}>
      {can && r.status === "draft" && <StatusButton className="btn primary" action={submitPRAction.bind(null, id)} label="Submit" />}</PageHead>
    {d.appr?.status === "rejected" && <Alert tone="bad">Rejected: {d.appr.reason}</Alert>}
    {r.reason && <p className="muted">{r.reason}</p>}
    <div className="card flush tablewrap"><table><thead><tr><th>Item</th><th className="num">Quantity</th><th>Supplier</th><th className="num">Est. unit cost</th></tr></thead><tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.sku} — {l.name}</td><td className="num">{formatQty(l.qty)}</td><td>{l.supplier ?? "—"}</td><td className="num">{formatMoney(l.est_unit_cost_paise)}</td></tr>)}</tbody></table></div>
    {d.pos.length > 0 && <div className="card"><h3>Purchase orders</h3>{d.pos.map((p: any) => <p key={p.id}><Link href={`/app/procurement/orders/${p.id}`}>{p.number}</Link></p>)}</div>}
    {can && r.status === "approved" && <div className="card"><h2>Convert to purchase orders</h2><p className="muted small">One order is created per supplier.</p>
      <ActionForm action={convertPRAction.bind(null, id)} submit="Create purchase order(s)"><div className="grid g2"><Field name="warehouse_id" label="Receive into" type="select" required>{d.whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Field>
        <Field name="supplier_id" label="Supplier for lines without one" type="select"><option value="">—</option>{d.sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Field></div></ActionForm></div>}</>);
}
