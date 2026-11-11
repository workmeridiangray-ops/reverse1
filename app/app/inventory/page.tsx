import { requireCompany } from "@/lib/server/auth";
import { rd, PER, pg, itemOpts, locOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Filters, Pager, A, Badge, Field, Grid, Hidden, Note, fmt, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { transferAction, adjustAction, reverseAction, openingStock } from "../actions";
import { can } from "@/lib/server/perms";
import { randomUUID } from "node:crypto";
export const metadata = { title: "Stock & movements" };
export const dynamic = "force-dynamic";
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("inv.read"); const sp = await searchParams; const page = pg(sp);
  const d = await rd(a, async (c) => ({
    bal: (await c.query(`select i.code, i.name, i.uom, l.code loc, l.kind, ba.code batch, ba.status, b.qty, b.item_id from stock_balances b join items i on i.id=b.item_id join locations l on l.id=b.location_id left join batches ba on ba.id=b.batch_id ${sp.q ? "where i.code ilike $1 or i.name ilike $1 or ba.code ilike $1" : ""} order by i.code, l.code limit 200`, sp.q ? [`%${sp.q}%`] : [])).rows,
    mv: (await c.query(`select m.*, i.code, l.code loc, ba.code batch, (select 1 from stock_movements r where r.reverses_id=m.id) reversed from stock_movements m join items i on i.id=m.item_id join locations l on l.id=m.location_id left join batches ba on ba.id=m.batch_id order by m.seq desc limit ${PER} offset ${(page - 1) * PER}`)).rows,
    total: Number((await c.query("select count(*) n from stock_movements")).rows[0].n), items: await itemOpts(c), locs: await locOpts(c), batches: (await c.query("select b.id, b.code, i.code ic from batches b join items i on i.id=b.item_id order by b.code limit 300")).rows }));
  const post = can(a.membership.role, "inv.post"), adj = can(a.membership.role, "inv.adjust"); const bo = d.batches.map((b: any) => ({ value: b.id, label: `${b.code} (${b.ic})` }));
  return <Page title="Stock & movements" sub="The ledger is append-only: nothing is edited or deleted. Mistakes are reversed with a reason.">
    <Filters action="/app/inventory" q={sp.q} />
    <h2 className="mb-2 font-semibold">Balances</h2>
    <DataTable caption="Stock balances" rows={d.bal} empty="No stock yet. Receive against a purchase order, or post opening stock below." cols={[{ h: "Item", r: (r: any) => <A href={`/app/items/${r.item_id}`}>{r.code}</A> }, { h: "Location", r: (r: any) => r.loc }, { h: "Batch", r: (r: any) => r.batch ?? "—" }, { h: "Batch status", r: (r: any) => (r.status ? <Badge s={r.status} /> : "—") }, { h: "Qty", r: (r: any) => `${fmt(r.qty, 3)} ${r.uom}`, num: true }]} />
    <h2 className="mb-2 mt-6 font-semibold">Movement ledger</h2>
    <DataTable caption="Movements" rows={d.mv} cols={[{ h: "#", r: (r: any) => r.seq, num: true, hideSm: true }, { h: "When", r: (r: any) => dt(r.posted_at) }, { h: "Item", r: (r: any) => r.code }, { h: "Kind", r: (r: any) => r.kind }, { h: "Loc", r: (r: any) => r.loc, hideSm: true }, { h: "Batch", r: (r: any) => r.batch ?? "—", hideSm: true }, { h: "Qty", r: (r: any) => fmt(r.qty, 3), num: true }, { h: "Note", r: (r: any) => r.reversed ? "reversed" : r.reverses_id ? "reversal" : (r.note ?? ""), hideSm: true },
      ...(adj ? [{ h: "", r: (r: any) => !r.reversed && r.kind !== "reversal" ? <details><summary className="cursor-pointer text-brand">Reverse</summary><ActionForm action={reverseAction} submit="Post reversal" small danger confirm="Post a reversing movement?" className="mt-2 w-56"><Hidden name="id" value={r.id} /><Field label="Reason" name="reason" required /></ActionForm></details> : null }] : [])]} />
    <Pager page={page} total={d.total} per={PER} base={`/app/inventory?q=${sp.q ?? ""}`} />
    {post && <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <Card title="Transfer between locations"><ActionForm action={transferAction} submit="Transfer" resetOnOk><Hidden name="key" value={randomUUID()} /><Grid><Field label="Item" name="item" required options={d.items} /><Field label="Batch (if tracked)" name="batch" options={bo} /><Field label="From" name="from" required options={d.locs} /><Field label="To" name="to" required options={d.locs} /><Field label="Quantity" name="qty" type="number" step="any" required /></Grid></ActionForm></Card>
      {adj && <Card title="Stock count / adjustment"><Note>Enter what you counted; the system posts the difference. A reason is mandatory.</Note><ActionForm action={adjustAction} submit="Post count" resetOnOk><Grid><Field label="Item" name="item" required options={d.items} /><Field label="Batch" name="batch" options={bo} /><Field label="Location" name="loc" required options={d.locs} /><Field label="Counted quantity" name="counted" type="number" step="any" required /><Field label="Reason" name="reason" required className="sm:col-span-2" /></Grid></ActionForm></Card>}
      {adj && <Card title="Opening stock (migration)"><ActionForm action={openingStock} submit="Post opening stock" resetOnOk><Hidden name="key" value={randomUUID()} /><Grid><Field label="Item" name="item" required options={d.items} /><Field label="Location" name="loc" required options={d.locs} /><Field label="Quantity" name="qty" type="number" step="any" required /><Field label="Unit cost (₹)" name="cost" placeholder="0.00" /><Field label="Batch code (tracked items)" name="batch" /></Grid></ActionForm></Card>}
    </div>}</Page>;
}
