import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Hidden, Note, A, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { confirmOrder, cancelOrder } from "../../actions";
import { Documents } from "@/components/Documents";
import { can } from "@/lib/server/perms";
import { shortagePreview } from "@/lib/server/svc/planning";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("sales.read"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => { const o = (await c.query("select o.*, cu.name customer from sales_orders o join customers cu on cu.id=o.customer_id where o.id=$1", [id])).rows[0]; if (!o) return null;
    const lines = (await c.query("select l.*, i.code, i.name from sales_order_lines l join items i on i.id=l.item_id where order_id=$1 order by line_no", [id])).rows;
    for (const l of lines) { l.sp = await shortagePreview(c, l.item_id, Number(l.qty)); l.jobs = (await c.query("select id, number, status from work_orders where so_line_id=$1", [l.id])).rows; }
    return { o, lines }; });
  if (!d) notFound(); const { o } = d; const w = can(a.membership.role, "sales.write");
  return <Page title={`Order ${o.number}`} crumbs={[["Orders", "/app/sales"], [o.number]]} sub={o.customer} actions={<Badge s={o.status} />}>
    {o.status === "cancelled" && <Note tone="danger">Cancelled: {o.cancel_reason}</Note>}
    <Card title="Lines"><DataTable rows={d.lines} cols={[{ h: "#", r: (r: any) => r.line_no, num: true }, { h: "Item", r: (r: any) => `${r.code} — ${r.name}` }, { h: "Qty", r: (r: any) => fmt(r.qty), num: true }, { h: "Shipped", r: (r: any) => fmt(r.shipped_qty), num: true }, { h: "Due", r: (r: any) => date(r.due_date) }, { h: "Promise", r: (r: any) => date(r.promised_date), hideSm: true }, { h: "Supply", r: (r: any) => r.supply.toUpperCase(), hideSm: true },
      { h: "Shortage preview", r: (r: any) => r.sp.short > 0 ? <span className="text-warn">{fmt(r.sp.short)} short (free {fmt(Math.max(r.sp.free, 0))})</span> : <span className="text-ok">covered from stock</span> }, { h: "Jobs", r: (r: any) => r.jobs.map((j: any) => <A key={j.id} href={`/app/production/${j.id}`} className="mr-2">{j.number}</A>) }]} />
      <p className="mt-3 text-xs text-muted">Promise dates are planning estimates (stock on hand or item lead time + buffer), not an unconditional capacity guarantee.</p></Card>
    {w && o.status === "draft" && <ActionForm action={confirmOrder} submit="Confirm order" className="mt-4"><Hidden name="id" value={o.id} /></ActionForm>}
    {w && ["draft", "confirmed"].includes(o.status) && <Card title="Cancel order" className="mt-4"><ActionForm action={cancelOrder} submit="Cancel order" danger confirm="Cancel this order? Reservations will be released."><Hidden name="id" value={o.id} /><Field label="Reason" name="reason" required /><p className="mt-1 text-xs text-muted">Released jobs and reserved material are listed after cancelling so they can be reviewed.</p></ActionForm></Card>}
  <Documents auth={a} entity="sales_order" id={o.id} /></Page>;
}
