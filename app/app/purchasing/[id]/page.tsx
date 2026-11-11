import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd, locOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Hidden, Note, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { poWorkflow, receivePoAction } from "../../actions";
import { Documents } from "@/components/Documents";
import { can } from "@/lib/server/perms";
import { formatINR } from "@/lib/domain/money";
import { randomUUID } from "node:crypto";
export const dynamic = "force-dynamic";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("proc.read"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => { const p = (await c.query("select p.*, s.name supplier from purchase_orders p join suppliers s on s.id=p.supplier_id where p.id=$1", [id])).rows[0]; if (!p) return null;
    return { p, lines: (await c.query("select l.*, i.code, i.name, i.tracking from purchase_order_lines l join items i on i.id=l.item_id where po_id=$1 order by i.code", [id])).rows, rcpts: (await c.query("select * from receipts where po_id=$1 order by created_at", [id])).rows, locs: await locOpts(c, "stock") }; });
  if (!d) notFound(); const { p } = d; const total = d.lines.reduce((s: number, l: any) => s + Number(l.qty) * Number(l.unit_price_paise), 0);
  return <Page title={`PO ${p.number}`} crumbs={[["Purchase orders", "/app/purchasing"], [p.number]]} sub={p.supplier} actions={<Badge s={p.status} />}>
    {p.reject_reason && p.status === "draft" && <Note tone="warn">Returned: {p.reject_reason}</Note>}
    <Card title={`Lines · total ${formatINR(Math.round(total))}`}><DataTable rows={d.lines} cols={[{ h: "Item", r: (r: any) => `${r.code} — ${r.name}` }, { h: "Ordered", r: (r: any) => fmt(r.qty), num: true }, { h: "Received", r: (r: any) => fmt(r.received_qty), num: true }, { h: "Outstanding", r: (r: any) => fmt(Number(r.qty) - Number(r.received_qty)), num: true }, { h: "Price", r: (r: any) => formatINR(r.unit_price_paise), num: true, hideSm: true }, { h: "Due", r: (r: any) => date(r.due_date), hideSm: true }]} /></Card>
    {p.status === "draft" && can(a.membership.role, "proc.write") && <ActionForm action={poWorkflow} submit="Submit for approval" className="mt-4"><Hidden name="id" value={p.id} /><input type="hidden" name="op" value="submit" /></ActionForm>}
    {p.status === "pending_approval" && can(a.membership.role, "proc.approve") && <Card title="Approval" className="mt-4"><ActionForm action={poWorkflow} submit="Approve"><Hidden name="id" value={p.id} /><input type="hidden" name="op" value="approve" /></ActionForm><ActionForm action={poWorkflow} submit="Reject" danger className="mt-3"><Hidden name="id" value={p.id} /><input type="hidden" name="op" value="reject" /><Field label="Reason (required)" name="reason" /></ActionForm><p className="mt-2 text-xs text-muted">You cannot approve an order you created.</p></Card>}
    {["approved", "partial"].includes(p.status) && can(a.membership.role, "inv.post") && <Card title="Receive goods" className="mt-4"><ActionForm action={receivePoAction} submit="Post receipt"><Hidden name="po" value={p.id} /><Hidden name="key" value={randomUUID()} />
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Supplier invoice / challan ref" name="invoice" /><Field label="Receive into" name="loc" required options={d.locs} /></div>
      <div className="mt-3 space-y-2">{d.lines.filter((l: any) => Number(l.received_qty) < Number(l.qty)).map((l: any) => <div key={l.id} className="grid gap-2 sm:grid-cols-3"><div className="self-end pb-2 text-sm">{l.code} (open {fmt(Number(l.qty) - Number(l.received_qty))})</div><Field label="Receive now" name={`q_${l.id}`} type="number" step="any" />{l.tracking !== "none" ? <Field label="Supplier batch / lot" name={`b_${l.id}`} hint="Goes to quarantine until inspected" /> : <div />}</div>)}</div></ActionForm></Card>}
    {d.rcpts.length > 0 && <Card title="Receipts" className="mt-4"><ul className="text-sm">{d.rcpts.map((r: any) => <li key={r.id}>{r.number} · invoice ref {r.supplier_invoice_ref ?? "—"} · {date(r.created_at)}</li>)}</ul></Card>}<Documents auth={a} entity="purchase_order" id={p.id} /></Page>;
}
