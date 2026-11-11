import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Note, Hidden, Field, A, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { portalDeliver } from "./actions";
export const metadata = { title: "Portal" };
export const dynamic = "force-dynamic";
export default async function P() {
  const a = await requireCompany(); const party = a.membership.partyId; const isCust = a.membership.role === "customer";
  if (!party) return <Page title="Portal"><Note tone="warn">Your account is not linked to a customer or supplier yet. Ask {a.company.name} to re-send your invitation.</Note></Page>;
  if (isCust) {
    const d = await rd(a, async (c) => ({
      lines: (await c.query(`select o.number, l.line_no, i.code, i.name, l.qty, l.shipped_qty, l.promised_date, l.due_date, o.status,
        (select count(*) from work_orders w where w.so_line_id=l.id and w.status in ('released','in_progress')) in_prod, (select count(*) from work_orders w where w.so_line_id=l.id and w.status='completed') made
        from sales_order_lines l join sales_orders o on o.id=l.order_id join items i on i.id=l.item_id where o.customer_id=$1 and o.status<>'draft' order by o.created_at desc`, [party])).rows,
      ships: (await c.query("select * from shipments where customer_id=$1 and status<>'packing' order by dispatched_at desc", [party])).rows,
      docs: (await c.query(`select d.* from documents d where d.shared_with_party and ((d.entity='shipment' and d.entity_id in (select id from shipments where customer_id=$1)) or (d.entity='sales_order' and d.entity_id in (select id from sales_orders where customer_id=$1)))`, [party])).rows }));
    const stage = (l: any) => l.status === "cancelled" ? "cancelled" : Number(l.shipped_qty) >= Number(l.qty) ? "Dispatched" : Number(l.shipped_qty) > 0 ? "Partly dispatched" : Number(l.in_prod) > 0 ? "In production" : Number(l.made) > 0 ? "Ready" : "Confirmed";
    return <Page title="Your orders" sub="Approved milestones only. Dates are estimates, not guarantees.">
      <DataTable rows={d.lines} empty="No orders yet." cols={[{ h: "Order", r: (r: any) => `${r.number}/${r.line_no}` }, { h: "Item", r: (r: any) => `${r.code} — ${r.name}` }, { h: "Qty", r: (r: any) => `${fmt(r.shipped_qty)} / ${fmt(r.qty)}`, num: true }, { h: "Requested", r: (r: any) => date(r.due_date), hideSm: true }, { h: "Estimated", r: (r: any) => date(r.promised_date), hideSm: true }, { h: "Progress", r: (r: any) => <Badge s={stage(r) === "cancelled" ? "cancelled" : "info"} label={stage(r)} /> }]} />
      <h2 className="mb-2 mt-6 font-semibold">Shipments</h2>
      <DataTable rows={d.ships} empty="Nothing dispatched yet." cols={[{ h: "Shipment", r: (r: any) => r.number }, { h: "Dispatched", r: (r: any) => date(r.dispatched_at) }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "", r: (r: any) => r.status === "dispatched" ? <ActionForm action={portalDeliver} submit="Confirm received" small><Hidden name="id" value={r.id} /><Field label="Note" name="note" /></ActionForm> : null }]} />
      <Card title="Documents" className="mt-6">{d.docs.length ? <ul className="text-sm">{d.docs.map((x: any) => <li key={x.id}><A href={`/api/files/${x.id}`}>{x.filename}</A></li>)}</ul> : <p className="text-sm text-muted">No shared documents.</p>}</Card></Page>;
  }
  const d = await rd(a, async (c) => ({ pos: (await c.query(`select p.id, p.number, p.status, (select count(*) from purchase_order_lines l where l.po_id=p.id) n from purchase_orders p where p.supplier_id=$1 and p.status in ('approved','partial','received') order by p.created_at desc`, [party])).rows,
    lines: (await c.query(`select p.number, i.code, i.name, l.qty, l.received_qty, l.due_date from purchase_order_lines l join purchase_orders p on p.id=l.po_id join items i on i.id=l.item_id where p.supplier_id=$1 and p.status in ('approved','partial') and l.received_qty<l.qty order by l.due_date`, [party])).rows,
    subs: (await c.query("select o.number, i.code, o.qty_sent, o.qty_received, o.qty_lost, o.expected_return, o.status from subcontract_orders o join items i on i.id=o.item_id where o.supplier_id=$1 order by o.created_at desc", [party])).rows,
    docs: (await c.query("select d.* from documents d where d.shared_with_party and d.entity='purchase_order' and d.entity_id in (select id from purchase_orders where supplier_id=$1)", [party])).rows }));
  return <Page title="Your purchase orders" sub="Only orders placed with you and agreed documents are shown.">
    <h2 className="mb-2 font-semibold">Delivery schedule (open lines)</h2>
    <DataTable rows={d.lines} empty="No open deliveries." cols={[{ h: "PO", r: (r: any) => r.number }, { h: "Item", r: (r: any) => `${r.code} — ${r.name}` }, { h: "Outstanding", r: (r: any) => fmt(Number(r.qty) - Number(r.received_qty)), num: true }, { h: "Due", r: (r: any) => date(r.due_date) }]} />
    <h2 className="mb-2 mt-6 font-semibold">Orders</h2><DataTable rows={d.pos} empty="None." cols={[{ h: "PO", r: (r: any) => r.number }, { h: "Lines", r: (r: any) => r.n, num: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} />
    <h2 className="mb-2 mt-6 font-semibold">Material sent to you for processing</h2><DataTable rows={d.subs} empty="None." cols={[{ h: "Order", r: (r: any) => r.number }, { h: "Item", r: (r: any) => r.code }, { h: "Sent", r: (r: any) => fmt(r.qty_sent), num: true }, { h: "Returned", r: (r: any) => fmt(r.qty_received), num: true }, { h: "Expected", r: (r: any) => date(r.expected_return) }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} />
    <Card title="Documents" className="mt-6">{d.docs.length ? <ul className="text-sm">{d.docs.map((x: any) => <li key={x.id}><A href={`/api/files/${x.id}`}>{x.filename}</A></li>)}</ul> : <p className="text-sm text-muted">No shared documents.</p>}</Card></Page>;
}
