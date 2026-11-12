import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Kpi, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
import { formatQty, formatMoney } from "@/lib/money";
export default async function Stock({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("inventory.view"); const sp = await searchParams; const q = sp1(sp.q), wh = sp1(sp.wh); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["b.tenant_id=$1", "($2::uuid[] is null or wh.branch_id=any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (q) { a.push(like(q)); w.push(`(i.sku ilike $${a.length} or i.name ilike $${a.length} or i.barcode ilike $${a.length})`); } if (wh) { a.push(wh); w.push(`b.warehouse_id=$${a.length}`); }
    const from = `from stock_balances b join items i on i.id=b.item_id and i.tenant_id=b.tenant_id join warehouses wh on wh.id=b.warehouse_id and wh.tenant_id=b.tenant_id where ${w.join(" and ")}`;
    const k = (await db.query(`select count(distinct b.item_id) items, coalesce(sum(b.on_hand * i.avg_cost_paise / 1000),0)::bigint value, coalesce(sum(b.reserved),0)::bigint reserved, coalesce(sum(b.in_transit),0)::bigint transit ${from}`, a)).rows[0];
    return { k, total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select i.id item_id, i.sku, i.name, i.base_unit, wh.name warehouse, b.on_hand, b.reserved, b.in_transit, i.reorder_level_qty ${from} order by i.sku, wh.name limit ${limit} offset ${offset}`, a)).rows,
      whs: (await db.query("select id, name from warehouses where tenant_id=$1 and ($2::uuid[] is null or branch_id=any($2)) order by name", [ctx.tenant.id, ctx.membership.branchIds])).rows };
  });
  return (<><PageHead title="Stock" crumbs={[["Inventory"], ["Stock"]]} sub="On hand, reserved for orders, available to promise, and inbound in transit — kept separate." />
    {ctx.perms.has("finance.view") ? <div className="kpis"><Kpi label="Items with stock" value={d.k.items} /><Kpi label="Inventory value (avg cost)" value={formatMoney(d.k.value)} /><Kpi label="Reserved" value={formatQty(d.k.reserved)} /><Kpi label="In transit" value={formatQty(d.k.transit)} /></div> : <div className="kpis"><Kpi label="Items with stock" value={d.k.items} /><Kpi label="Reserved" value={formatQty(d.k.reserved)} /><Kpi label="In transit" value={formatQty(d.k.transit)} /></div>}
    <Filters action="/app/inventory" q={q} extra={<div><label className="f" htmlFor="wh">Warehouse</label><select id="wh" name="wh" defaultValue={wh}><option value="">All</option>{d.whs.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No stock recorded">Receive goods against a purchase order, or load opening stock under Counts & adjustments.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Item</th><th>Warehouse</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Available</th><th className="num">In transit</th><th>Unit</th></tr></thead><tbody>
        {d.rows.map((r: any, i: number) => <tr key={i}><td data-label="Item"><Link href={`/app/inventory/ledger?item=${r.item_id}`}>{r.sku}</Link> — {r.name}</td><td data-label="Warehouse">{r.warehouse}</td><td data-label="On hand" className="num">{formatQty(r.on_hand)}</td><td data-label="Reserved" className="num">{formatQty(r.reserved)}</td>
          <td data-label="Available" className="num">{r.on_hand - r.reserved <= r.reorder_level_qty && r.reorder_level_qty > 0 ? <span className="badge warn">{formatQty(r.on_hand - r.reserved)}</span> : formatQty(r.on_hand - r.reserved)}</td><td data-label="In transit" className="num">{formatQty(r.in_transit)}</td><td data-label="Unit">{r.base_unit}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/inventory" params={{ q, wh }} /></div></>);
}
