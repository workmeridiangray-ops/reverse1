import { requireCompany } from "@/lib/server/auth";
import { rd, locOpts } from "@/lib/server/read";
import { Page, Card, DataTable, A, Badge, Field, Grid, Hidden, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createShipmentAction, returnAction } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Dispatch & returns" };
export default async function P() {
  const a = await requireCompany("ship.read");
  const d = await rd(a, async (c) => ({
    ships: (await c.query("select s.*, cu.name customer from shipments s join customers cu on cu.id=s.customer_id order by s.created_at desc limit 40")).rows,
    open: (await c.query(`select l.id, o.number, l.line_no, i.code, (l.qty-l.shipped_qty) open_qty, cu.name from sales_order_lines l join sales_orders o on o.id=l.order_id join items i on i.id=l.item_id join customers cu on cu.id=o.customer_id where o.status='confirmed' and l.shipped_qty<l.qty order by l.due_date limit 100`)).rows,
    avail: (await c.query(`select b.item_id, i.code, sum(b.qty) q from stock_balances b join items i on i.id=b.item_id join locations l on l.id=b.location_id left join batches ba on ba.id=b.batch_id where l.kind='stock' and (ba.id is null or ba.status='available') and i.kind <> 'buy' group by b.item_id, i.code`)).rows,
    batches: (await c.query("select b.id, b.code, i.code ic from batches b join items i on i.id=b.item_id where b.status='available' order by b.code limit 300")).rows, locs: await locOpts(c, "stock"),
    shipped: (await c.query("select s.id, s.number from shipments s where s.status in ('dispatched','delivered') order by s.created_at desc limit 50")).rows, items: (await c.query("select id, code from items where kind<>'buy' order by code")).rows }));
  const w = can(a.membership.role, "ship.write");
  return <Page title="Dispatch & returns" sub="Only released batches can be shipped. Returns must be inspected before restocking.">
    <Card title="Finished goods available to allocate"><DataTable rows={d.avail} empty="No finished goods in stock yet." cols={[{ h: "Item", r: (r: any) => r.code }, { h: "Available (released)", r: (r: any) => fmt(r.q, 3), num: true }]} /></Card>
    <h2 className="mb-2 mt-6 font-semibold">Shipments</h2>
    <DataTable rows={d.ships} empty="No shipments." cols={[{ h: "No.", r: (r: any) => <A href={`/app/shipping/${r.id}`}>{r.number}</A> }, { h: "Customer", r: (r: any) => r.customer }, { h: "Dispatched", r: (r: any) => date(r.dispatched_at), hideSm: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} />
    {w && <div className="mt-5 grid gap-4 lg:grid-cols-2"><Card title="Pack a shipment"><ActionForm action={createShipmentAction} submit="Create shipment"><Grid><Field label="Order line" name="line" required options={d.open.map((l: any) => ({ value: l.id, label: `${l.number}/${l.line_no} ${l.code} (open ${fmt(l.open_qty)}) — ${l.name}` }))} /><Field label="Batch" name="batch" options={d.batches.map((b: any) => ({ value: b.id, label: `${b.code} (${b.ic})` }))} hint="Quarantined batches are rejected" /><Field label="From location" name="loc" required options={d.locs} /><Field label="Quantity" name="qty" type="number" step="any" required /><Field label="Serial numbers (if serialised)" name="serials" type="textarea" className="sm:col-span-2" /></Grid></ActionForm></Card>
      <Card title="Log a customer return"><ActionForm action={returnAction} submit="Log return" resetOnOk><Grid><Field label="Shipment" name="ship" required options={d.shipped.map((s: any) => ({ value: s.id, label: s.number }))} /><Field label="Item" name="item" required options={d.items.map((i: any) => ({ value: i.id, label: i.code }))} /><Field label="Quantity" name="qty" type="number" required /><Field label="Reason" name="reason" required /></Grid></ActionForm></Card></div>}</Page>;
}
