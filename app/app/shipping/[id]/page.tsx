import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Hidden, Note, dt, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { dispatchAction, deliverAction } from "../../actions";
import { Documents } from "@/components/Documents";
import { can } from "@/lib/server/perms";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("ship.read"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => { const s = (await c.query("select s.*, cu.name customer from shipments s join customers cu on cu.id=s.customer_id where s.id=$1", [id])).rows[0]; if (!s) return null;
    return { s, lines: (await c.query("select l.*, i.code, b.code batch, o.number onum, sl.line_no from shipment_lines l join items i on i.id=l.item_id left join batches b on b.id=l.batch_id join sales_order_lines sl on sl.id=l.so_line_id join sales_orders o on o.id=sl.order_id where shipment_id=$1", [id])).rows }; });
  if (!d) notFound(); const { s } = d; const w = can(a.membership.role, "ship.write");
  return <Page title={`Shipment ${s.number}`} crumbs={[["Dispatch", "/app/shipping"], [s.number]]} sub={s.customer} actions={<Badge s={s.status} />}>
    <Card title="Lines (traced to originating order)"><DataTable rows={d.lines} cols={[{ h: "Order", r: (r: any) => `${r.onum}/${r.line_no}` }, { h: "Item", r: (r: any) => r.code }, { h: "Batch", r: (r: any) => r.batch ?? "—" }, { h: "Qty", r: (r: any) => fmt(r.qty), num: true }, { h: "Serials", r: (r: any) => (r.serials as string[]).join(", ") || "—", hideSm: true }]} /></Card>
    {s.status === "packing" && w && <ActionForm action={dispatchAction} submit="Dispatch" className="mt-4" confirm="Dispatch now? Stock will be reduced."><Hidden name="id" value={s.id} /><Field label="Invoice reference" name="invoice" className="max-w-sm" hint="Your accounting system’s invoice number — for reference only." /></ActionForm>}
    {s.status === "dispatched" && w && <ActionForm action={deliverAction} submit="Confirm delivery" className="mt-4"><Hidden name="id" value={s.id} /><Field label="Delivery note / receiver" name="note" className="max-w-sm" /></ActionForm>}
    {s.dispatched_at && <Note>Dispatched {dt(s.dispatched_at)}{s.invoice_ref ? ` · invoice ${s.invoice_ref}` : ""}{s.delivered_at ? ` · delivered ${dt(s.delivered_at)}` : ""}</Note>}<Documents auth={a} entity="shipment" id={s.id} /></Page>;
}
