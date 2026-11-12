import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Empty, Pager, Badge } from "@/components/ui";
import { paging, sp1, pages, type SP } from "@/lib/list";
import { formatQty } from "@/lib/money";
const LINK: Record<string, (id: string) => string> = { dispatch: (i) => `/app/fulfilment/dispatches/${i}`, goods_receipt: () => `/app/procurement/orders`, customer_return: () => `/app/fulfilment/returns`, transfer: () => `/app/inventory/transfers`, stock_count: () => `/app/inventory/counts` };
export default async function Ledger({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("inventory.view"); const sp = await searchParams; const item = sp1(sp.item), wh = sp1(sp.wh); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const w = ["m.tenant_id=$1", "($2::uuid[] is null or wh.branch_id=any($2))"]; const a: any[] = [ctx.tenant.id, ctx.membership.branchIds];
    if (/^[0-9a-f-]{36}$/.test(item)) { a.push(item); w.push(`m.item_id=$${a.length}`); } if (/^[0-9a-f-]{36}$/.test(wh)) { a.push(wh); w.push(`m.warehouse_id=$${a.length}`); }
    const from = `from stock_movements m join items i on i.id=m.item_id and i.tenant_id=m.tenant_id join warehouses wh on wh.id=m.warehouse_id and wh.tenant_id=m.tenant_id where ${w.join(" and ")}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select m.*, i.sku, i.name, wh.name warehouse ${from} order by m.id desc limit ${limit} offset ${offset}`, a)).rows,
      items: (await db.query("select id, sku||' — '||name n from items where tenant_id=$1 and kind='goods' order by sku limit 500", [ctx.tenant.id])).rows, whs: (await db.query("select id, name from warehouses where tenant_id=$1 order by name", [ctx.tenant.id])).rows };
  });
  return (<><PageHead title="Item ledger" crumbs={[["Inventory"], ["Ledger"]]} sub="Every stock movement is permanent. Corrections are new, linked movements — never edits." />
    <form className="toolbar" method="get" role="search"><div><label className="f" htmlFor="item">Item</label><select id="item" name="item" defaultValue={item}><option value="">All items</option>{d.items.map((i: any) => <option key={i.id} value={i.id}>{i.n}</option>)}</select></div>
      <div><label className="f" htmlFor="wh">Warehouse</label><select id="wh" name="wh" defaultValue={wh}><option value="">All</option>{d.whs.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div><button className="btn">Apply</button></form>
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No movements">Nothing has moved yet for this selection.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>#</th><th>When</th><th>Item</th><th>Warehouse</th><th>Type</th><th className="num">Qty change</th><th>Source</th></tr></thead><tbody>
        {d.rows.map((m: any) => <tr key={m.id}><td data-label="#">{m.id}</td><td data-label="When">{new Date(m.created_at).toLocaleString("en-IN")}</td><td data-label="Item">{m.sku} — {m.name}</td><td data-label="Warehouse">{m.warehouse}</td><td data-label="Type"><Badge status={m.kind === "reversal" ? "reversed" : "done"} label={m.kind.replace("_", " ")} /></td><td data-label="Qty" className="num" style={{ color: m.qty_delta < 0 ? "var(--bad)" : "var(--ok)" }}>{m.qty_delta > 0 ? "+" : ""}{formatQty(m.qty_delta)}</td>
          <td data-label="Source">{LINK[m.doc_type] ? <Link href={LINK[m.doc_type](m.doc_id)}>{m.doc_type.replace("_", " ")}</Link> : m.doc_type}{m.note ? ` · ${m.note}` : ""}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/inventory/ledger" params={{ item, wh }} /></div></>);
}
