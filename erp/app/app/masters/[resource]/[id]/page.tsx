import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { RESOURCES } from "@/lib/masters";
import { PageHead, Badge, Alert } from "@/components/ui";
import { MasterForm } from "@/components/MasterForm";
import { ActionForm, Field } from "@/components/ActionForm";
import { saveMasterAction, setMasterStatusAction, addUomAction, setPriceAction, addBinAction } from "../../actions";
import { loadOpts } from "../page";
import { StatusButton } from "@/components/StatusButton";
import { formatMoney, formatQty } from "@/lib/money";

export default async function MasterDetail({ params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params; const r = RESOURCES[resource]; if (!r || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant("masters.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const row = (await db.query(`select * from ${r.table} where id=$1 and tenant_id=$2`, [id, ctx.tenant.id])).rows[0];
    if (!row) return null;
    const custom = (await db.query(`select f.key, f.label, f.kind, v.value from custom_fields f left join custom_values v on v.tenant_id=f.tenant_id and v.entity=f.entity and v.key=f.key and v.record_id=$3 where f.tenant_id=$1 and f.entity=$2 and f.status='active'`, [ctx.tenant.id, resource, id])).rows;
    const extra: any = {};
    if (resource === "items") {
      extra.uoms = (await db.query("select * from item_uoms where tenant_id=$1 and item_id=$2 order by unit", [ctx.tenant.id, id])).rows;
      extra.stock = (await db.query("select w.name, b.on_hand, b.reserved, b.in_transit from stock_balances b join warehouses w on w.id=b.warehouse_id and w.tenant_id=b.tenant_id where b.tenant_id=$1 and b.item_id=$2 order by w.name", [ctx.tenant.id, id])).rows;
    }
    if (resource === "warehouses") extra.bins = (await db.query("select * from bins where tenant_id=$1 and warehouse_id=$2 order by code", [ctx.tenant.id, id])).rows;
    if (resource === "price_lists") {
      extra.prices = (await db.query("select i.sku, i.name, p.price_paise from price_list_items p join items i on i.id=p.item_id and i.tenant_id=p.tenant_id where p.tenant_id=$1 and p.price_list_id=$2 order by i.sku", [ctx.tenant.id, id])).rows;
      extra.items = (await db.query("select id, sku||' — '||name name from items where tenant_id=$1 and status='active' order by sku", [ctx.tenant.id])).rows;
    }
    if (resource === "customers") extra.recent = (await db.query("select number, status, total_paise, id from sales_orders where tenant_id=$1 and customer_id=$2 order by created_at desc limit 5", [ctx.tenant.id, id])).rows;
    return { row, custom, extra, opts: await loadOpts(db, ctx.tenant.id) };
  });
  if (!d) notFound();
  const canEdit = ctx.perms.has("masters.manage") && !ctx.readOnlyReason;
  const e = d.extra;
  return (
    <>
      <PageHead title={d.row.name} crumbs={[["Master data"], [r.title, `/app/masters/${resource}`], [d.row[r.codeCol]]]} sub={<Badge status={d.row.status} />}>
        {canEdit && <StatusButton action={setMasterStatusAction.bind(null, resource, id, d.row.status === "active" ? "retired" : "active")} label={d.row.status === "active" ? "Retire" : "Reactivate"} confirm={d.row.status === "active" ? `Retire ${d.row.name}? History is kept, but it can’t be used on new documents.` : undefined} />}
      </PageHead>
      {d.row.status === "retired" && <Alert tone="warn">This {r.singular} is retired. Existing documents keep their history; new documents cannot use it.</Alert>}
      <div className="card">{canEdit ? <MasterForm r={r} values={d.row} opts={d.opts} custom={d.custom.map((c: any) => ({ key: c.key, label: c.label, kind: c.kind, value: c.value }))} action={saveMasterAction.bind(null, resource, id)} submit="Save changes" />
        : <dl className="kv">{r.fields.map((f) => <div key={f.name} style={{ display: "contents" }}><dt>{f.label}</dt><dd>{String(d.row[f.name] ?? "—")}</dd></div>)}</dl>}</div>
      {resource === "items" && <>
        <div className="card"><h2>Stock by warehouse</h2>{e.stock.length === 0 ? <p className="muted">No stock recorded yet.</p> : <div className="tablewrap"><table><thead><tr><th>Warehouse</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Available</th><th className="num">In transit in</th></tr></thead><tbody>
          {e.stock.map((s: any) => <tr key={s.name}><td>{s.name}</td><td className="num">{formatQty(s.on_hand)}</td><td className="num">{formatQty(s.reserved)}</td><td className="num">{formatQty(s.on_hand - s.reserved)}</td><td className="num">{formatQty(s.in_transit)}</td></tr>)}</tbody></table></div>}
          <p><Link href={`/app/inventory/ledger?item=${id}`}>View item ledger →</Link></p></div>
        <div className="card"><h2>Unit conversions</h2><p className="muted small">Base unit: {d.row.base_unit}. Add selling/buying units such as “box = 12 {d.row.base_unit}”.</p>
          {e.uoms.length > 0 && <ul>{e.uoms.map((u: any) => <li key={u.id}>1 {u.unit} = {formatQty(u.factor_milli)} {d.row.base_unit}</li>)}</ul>}
          {canEdit && <ActionForm action={addUomAction.bind(null, id)} submit="Add conversion" resetOnSuccess><div className="grid g2"><Field name="unit" label="Unit name" placeholder="box" /><Field name="factor" label={`Number of ${d.row.base_unit} in one`} placeholder="12" /></div></ActionForm>}</div></>}
      {resource === "warehouses" && <div className="card"><h2>Bins</h2><p className="muted small">Bins identify locations inside a warehouse and print on labels. Stock quantities are tracked per warehouse.</p>
        {e.bins.length > 0 && <p>{e.bins.map((b: any) => <span key={b.id} className="badge" style={{ marginRight: 6 }}>{b.code}</span>)}</p>}
        {canEdit && <ActionForm action={addBinAction.bind(null, id)} submit="Add bin" resetOnSuccess><div className="grid g2"><Field name="code" label="Bin code" placeholder="A-01-03" /><Field name="description" label="Description" /></div></ActionForm>}</div>}
      {resource === "price_lists" && <div className="card"><h2>Prices</h2>
        {e.prices.length === 0 ? <p className="muted">No special prices yet — customers on this list fall back to the item sale price.</p> : <div className="tablewrap"><table><thead><tr><th>SKU</th><th>Item</th><th className="num">Price</th></tr></thead><tbody>{e.prices.map((p: any) => <tr key={p.sku}><td>{p.sku}</td><td>{p.name}</td><td className="num">{formatMoney(p.price_paise)}</td></tr>)}</tbody></table></div>}
        {canEdit && <ActionForm action={setPriceAction.bind(null, id)} submit="Save price" resetOnSuccess><div className="grid g2"><Field name="item_id" label="Item" type="select"><option value="">Choose…</option>{e.items.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}</Field><Field name="price" label="Price per base unit (₹)" /></div></ActionForm>}</div>}
      {resource === "customers" && e.recent.length > 0 && <div className="card"><h2>Recent orders</h2><ul>{e.recent.map((o: any) => <li key={o.id}><Link href={`/app/sales/orders/${o.id}`}>{o.number}</Link> — <Badge status={o.status} /> {formatMoney(o.total_paise)}</li>)}</ul></div>}
    </>
  );
}
