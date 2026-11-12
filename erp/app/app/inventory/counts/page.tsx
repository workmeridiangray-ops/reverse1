import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { countAction, openingAction } from "../actions";
import { formatQty } from "@/lib/money";
export default async function Counts() {
  const ctx = await requireTenant("inventory.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({
    rows: (await db.query("select c.*, i.sku, i.name, w.name wname from stock_counts c join items i on i.id=c.item_id and i.tenant_id=c.tenant_id join warehouses w on w.id=c.warehouse_id and w.tenant_id=c.tenant_id where c.tenant_id=$1 order by c.created_at desc limit 100", [ctx.tenant.id])).rows,
    whs: (await db.query("select id, name from warehouses where tenant_id=$1 and status='active' order by name", [ctx.tenant.id])).rows, items: (await db.query("select id, sku||' — '||name n from items where tenant_id=$1 and kind='goods' and status='active' order by sku limit 1000", [ctx.tenant.id])).rows }));
  const can = ctx.perms.has("inventory.adjust") && !ctx.readOnlyReason;
  const sel = (<><Field name="item_id" label="Item" type="select" required><option value="">Choose…</option>{d.items.map((i: any) => <option key={i.id} value={i.id}>{i.n}</option>)}</Field>
    <Field name="warehouse_id" label="Warehouse" type="select" required>{d.whs.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Field></>);
  return (<><PageHead title="Counts & adjustments" crumbs={[["Inventory"], ["Counts"]]} sub="A physical count creates a variance. Posting it writes a stock movement and a ledger entry; large variances need approval." />
    {can && <><details className="drawer" open><summary>Record a physical count</summary><div><ActionForm action={countAction} submit="Record count" resetOnSuccess><div className="grid g2">{sel}<Field name="counted" label="Counted quantity" required /><Field name="reason" label="Reason / note" required placeholder="Cycle count, damaged, found stock…" /></div></ActionForm></div></details>
      <details className="drawer"><summary>Load opening stock</summary><div><p className="muted small">One-time per item and warehouse. Balanced against owner equity in the ledger.</p><ActionForm action={openingAction} submit="Load opening stock" resetOnSuccess><div className="grid g2">{sel}<Field name="qty" label="Quantity" required /><Field name="cost" label="Unit cost (₹ per base unit)" required /></div></ActionForm></div></details></>}
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No counts yet" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Count</th><th>Item</th><th>Warehouse</th><th className="num">System</th><th className="num">Counted</th><th className="num">Variance</th><th>Status</th></tr></thead><tbody>
      {d.rows.map((c: any) => <tr key={c.id}><td data-label="Count">{c.number}</td><td data-label="Item">{c.sku} — {c.name}</td><td data-label="Warehouse">{c.wname}</td><td data-label="System" className="num">{formatQty(c.system_qty)}</td><td data-label="Counted" className="num">{formatQty(c.counted_qty)}</td><td data-label="Variance" className="num">{formatQty(c.variance_qty)}</td><td data-label="Status"><Badge status={c.status === "pending" ? "pending_approval" : c.status} /></td></tr>)}</tbody></table></div>}</div></>);
}
