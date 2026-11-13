import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd, opts } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, Note, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { addQuoteAction, awardAction } from "../../../actions3";
import { can } from "@/lib/server/perms";
import { formatINR } from "@/lib/domain/money";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("proc.read"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => { const r = (await c.query("select r.*, p.qty, p.needed_by, p.number prn, i.code from rfqs r join purchase_requests p on p.id=r.pr_id join items i on i.id=p.item_id where r.id=$1", [id])).rows[0]; if (!r) return null;
    return { r, quotes: (await c.query("select q.*, s.name from rfq_quotes q join suppliers s on s.id=q.supplier_id where rfq_id=$1 order by q.unit_price_paise", [id])).rows, sup: opts((await c.query("select id, code, name from suppliers where active order by code")).rows) }; });
  if (!d) notFound(); const w = can(a.membership.role, "proc.write"); const best = d.quotes[0]?.unit_price_paise;
  return <Page title={`${d.r.number} · ${d.r.code} × ${fmt(d.r.qty)}`} crumbs={[["Requests", "/app/purchasing/requests"], [d.r.number]]} sub={`From ${d.r.prn}`} actions={<Badge s={d.r.status} />}>
    <Card title="Quote comparison"><DataTable rows={d.quotes} empty="No quotes yet. Add what each supplier offered." cols={[{ h: "Supplier", r: (r: any) => r.name }, { h: "Unit price", r: (r: any) => <>{formatINR(r.unit_price_paise)}{r.unit_price_paise === best && <span className="ml-1 text-xs text-ok">lowest</span>}</>, num: true }, { h: "Total", r: (r: any) => formatINR(Math.round(Number(r.unit_price_paise) * Number(d.r.qty))), num: true }, { h: "Lead (days)", r: (r: any) => r.lead_days, num: true }, { h: "Note", r: (r: any) => r.note ?? "", hideSm: true },
      { h: "", r: (r: any) => d.r.status === "open" && w ? <ActionForm action={awardAction} submit="Award" small confirm="Award to this supplier and create a draft PO?"><Hidden name="rfq" value={id} /><Hidden name="quote" value={r.id} /></ActionForm> : r.id === d.r.awarded_quote_id ? <Badge s="approved" label="awarded" /> : null }]} /></Card>
    {d.r.status === "open" && w && <Card title="Record a supplier quote" className="mt-4"><ActionForm action={addQuoteAction} submit="Save quote" resetOnOk><Hidden name="rfq" value={id} /><Grid cols={4}><Field label="Supplier" name="supplier" required options={d.sup} /><Field label="Unit price (₹)" name="price" required /><Field label="Lead time (days)" name="lead" type="number" /><Field label="Note" name="note" /></Grid></ActionForm></Card>}
    <Note>Awarding creates a draft purchase order. It must still be submitted and approved by a different person.</Note></Page>;
}
