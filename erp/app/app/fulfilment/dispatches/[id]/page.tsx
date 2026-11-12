import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { deliveredAction } from "../../actions";
import { formatQty } from "@/lib/money";
import { PrintButton } from "@/components/PrintButton";
export default async function DispatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("sales.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const x = (await db.query("select d.*, o.number order_no, o.id oid, c.name customer, c.billing_address, w.name warehouse from dispatches d join sales_orders o on o.id=d.order_id and o.tenant_id=d.tenant_id join customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id join warehouses w on w.id=d.warehouse_id and w.tenant_id=d.tenant_id where d.id=$1 and d.tenant_id=$2 and ($3::uuid[] is null or o.branch_id=any($3))", [id, ctx.tenant.id, ctx.membership.branchIds])).rows[0];
    if (!x) return null;
    return { x, lines: (await db.query("select dl.qty, i.sku, i.name, i.base_unit from dispatch_lines dl join items i on i.id=dl.item_id and i.tenant_id=dl.tenant_id where dl.dispatch_id=$1", [id])).rows, files: (await db.query("select id, filename, size_bytes from files where owner_type='dispatch' and owner_id=$1", [id])).rows };
  });
  if (!d) notFound(); const { x } = d;
  return (<><PageHead title={`Delivery note ${x.number}`} crumbs={[["Fulfilment"], ["Dispatches", "/app/fulfilment/dispatches"], [x.number]]} sub={<Badge status={x.status} />}><PrintButton /></PageHead>
    <div className="card"><dl className="kv"><dt>Order</dt><dd><Link href={`/app/sales/orders/${x.oid}`}>{x.order_no}</Link></dd><dt>Customer</dt><dd>{x.customer}<br /><span className="muted">{x.billing_address}</span></dd><dt>From</dt><dd>{x.warehouse}</dd><dt>Carrier</dt><dd>{x.carrier ?? "—"}</dd><dt>Tracking reference</dt><dd>{x.tracking_ref ?? "—"}</dd><dt>Dispatched</dt><dd>{new Date(x.created_at).toLocaleString("en-IN")}</dd>{x.delivered_at && <><dt>Delivered</dt><dd>{new Date(x.delivered_at).toLocaleString("en-IN")} {x.delivery_note}</dd></>}</dl></div>
    <div className="card flush tablewrap"><table><thead><tr><th>SKU</th><th>Item</th><th className="num">Quantity</th><th>Unit</th></tr></thead><tbody>{d.lines.map((l: any) => <tr key={l.sku}><td>{l.sku}</td><td>{l.name}</td><td className="num">{formatQty(l.qty)}</td><td>{l.base_unit}</td></tr>)}</tbody></table></div>
    <div className="card no-print"><h2>Proof of delivery</h2>
      {d.files.length ? <ul>{d.files.map((f: any) => <li key={f.id}><a href={`/app/files/${f.id}`}>{f.filename}</a> ({Math.ceil(f.size_bytes / 1024)} KB)</li>)}</ul> : <p className="muted">No proof attached yet.</p>}
      {ctx.perms.has("inventory.post") && !ctx.readOnlyReason && x.status === "posted" && <ActionForm action={deliveredAction.bind(null, id)} submit="Mark delivered"><Field name="note" label="Delivery note (who received it)" /><div className="field"><label className="f" htmlFor="proof">Proof (PDF, PNG, JPG — max 5 MB)</label><input id="proof" name="proof" type="file" accept=".pdf,.png,.jpg,.jpeg" /></div></ActionForm>}
      {x.status === "delivered" && ctx.perms.has("inventory.post") && <ActionForm action={deliveredAction.bind(null, id)} submit="Attach another file"><div className="field"><input name="proof" type="file" accept=".pdf,.png,.jpg,.jpeg" aria-label="Proof file" /></div></ActionForm>}</div></>);
}
