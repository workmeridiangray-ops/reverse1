import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { transferAction, receiveTransferAction, cancelTransferAction } from "../actions";
import { formatQty } from "@/lib/money";
export default async function Transfers() {
  const ctx = await requireTenant("inventory.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({
    rows: (await db.query("select t.*, i.sku, i.name, f.name fname, w.name tname from stock_transfers t join items i on i.id=t.item_id and i.tenant_id=t.tenant_id join warehouses f on f.id=t.from_warehouse_id and f.tenant_id=t.tenant_id join warehouses w on w.id=t.to_warehouse_id and w.tenant_id=t.tenant_id where t.tenant_id=$1 order by t.created_at desc limit 100", [ctx.tenant.id])).rows,
    whs: (await db.query("select id, name from warehouses where tenant_id=$1 and status='active' order by name", [ctx.tenant.id])).rows, items: (await db.query("select id, sku||' — '||name n from items where tenant_id=$1 and kind='goods' and status='active' order by sku limit 1000", [ctx.tenant.id])).rows }));
  const can = ctx.perms.has("inventory.post") && !ctx.readOnlyReason;
  return (<><PageHead title="Stock transfers" crumbs={[["Inventory"], ["Transfers"]]} sub="Shipped stock leaves the source immediately and sits in transit until the destination confirms receipt." />
    {can && <details className="drawer"><summary>+ New transfer</summary><div><ActionForm action={transferAction} submit="Ship transfer" resetOnSuccess><div className="grid g2">
      <Field name="item_id" label="Item" type="select" required><option value="">Choose…</option>{d.items.map((i: any) => <option key={i.id} value={i.id}>{i.n}</option>)}</Field><Field name="qty" label="Quantity" required />
      <Field name="from" label="From" type="select" required><option value="">Choose…</option>{d.whs.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Field><Field name="to" label="To" type="select" required><option value="">Choose…</option>{d.whs.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Field></div></ActionForm></div></details>}
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No transfers" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Transfer</th><th>Item</th><th className="num">Qty</th><th>Route</th><th>Status</th><th></th></tr></thead><tbody>
      {d.rows.map((t: any) => <tr key={t.id}><td data-label="Transfer">{t.number}</td><td data-label="Item">{t.sku} — {t.name}</td><td data-label="Qty" className="num">{formatQty(t.qty)}</td><td data-label="Route">{t.fname} → {t.tname}</td><td data-label="Status"><Badge status={t.status} /></td>
        <td>{can && t.status === "in_transit" && <div className="row"><StatusButton className="btn sm primary" action={receiveTransferAction.bind(null, t.id)} label="Receive" />
          <details><summary className="btn sm">Cancel</summary><ActionForm action={cancelTransferAction.bind(null, t.id)} submit="Cancel transfer" danger><Field name="reason" label="Reason" required /></ActionForm></details></div>}</td></tr>)}</tbody></table></div>}</div></>);
}
