import { requireCompany } from "@/lib/server/auth";
import { rd, opts, itemOpts, locOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { sendSubAction, receiveSubAction } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Subcontracting" };
export default async function P() {
  const a = await requireCompany("proc.read");
  const d = await rd(a, async (c) => ({ rows: (await c.query("select o.*, s.name supplier, i.code from subcontract_orders o join suppliers s on s.id=o.supplier_id join items i on i.id=o.item_id order by o.created_at desc limit 50")).rows, sup: opts((await c.query("select id, code, name from suppliers order by code")).rows), items: await itemOpts(c), locs: await locOpts(c, "stock"), wos: opts((await c.query("select id, number from work_orders where status in ('released','in_progress')")).rows, (r) => r.number) }));
  return <Page title="Subcontracting" sub="Company-owned material sent to an outside processor stays visible until it returns, is lost or is reworked.">
    <DataTable rows={d.rows} empty="Nothing sent out." cols={[{ h: "Order", r: (r: any) => r.number }, { h: "Supplier", r: (r: any) => r.supplier }, { h: "Item", r: (r: any) => r.code }, { h: "Sent", r: (r: any) => fmt(r.qty_sent), num: true }, { h: "Received", r: (r: any) => fmt(r.qty_received), num: true }, { h: "Lost", r: (r: any) => fmt(r.qty_lost), num: true }, { h: "Expected", r: (r: any) => date(r.expected_return), hideSm: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> },
      { h: "Reconcile", r: (r: any) => r.status !== "closed" && can(a.membership.role, "inv.post") ? <details><summary className="cursor-pointer text-brand">Receive</summary><ActionForm action={receiveSubAction} submit="Post" small className="mt-2 w-60"><Hidden name="id" value={r.id} /><Field label="Good received" name="good" type="number" /><Field label="Lost / scrapped" name="lost" type="number" /><Field label="Into location" name="loc" required options={d.locs} /></ActionForm></details> : null }]} />
    {can(a.membership.role, "proc.write") && <Card title="Send material to a subcontractor" className="mt-4"><ActionForm action={sendSubAction} submit="Send material" resetOnOk><Grid cols={3}><Field label="Supplier" name="supplier" required options={d.sup} /><Field label="Item" name="item" required options={d.items} /><Field label="Quantity" name="qty" type="number" required /><Field label="From location" name="loc" required options={d.locs} /><Field label="Expected return" name="ret" type="date" required /><Field label="Linked job" name="wo" options={d.wos} /></Grid></ActionForm></Card>}</Page>;
}
