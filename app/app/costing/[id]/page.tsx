import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, Field, Grid, Hidden, DataTable, Note, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { costAdjustAction } from "../../actions";
import { jobCostFor } from "@/lib/server/svc/costing";
import { formatINR } from "@/lib/domain/money";
import { can } from "@/lib/server/perms";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("cost.read"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => { try { const j = await jobCostFor(c, id); return { j, adj: (await c.query("select * from cost_adjustments where work_order_id=$1 order by created_at", [id])).rows, issues: (await c.query("select m.*, i.code from stock_movements m join items i on i.id=m.item_id where m.ref_type='work_order' and m.ref_id=$1 and m.kind in ('issue','reversal') order by seq", [id])).rows }; } catch { return null; } });
  if (!d) notFound(); const { j } = d;
  const rows = [["Material (issued × cost)", j.material], ["Labour (actual time × rate)", j.labour], ["Overhead (% of labour)", j.overhead], ["Corrections", j.adjustments], ["Actual total", j.totalWithAdjustments], [`Standard (${j.wo.completed_qty} good × standard)`, j.standardTotal], ["Variance (actual − standard)", j.totalWithAdjustments - j.standardTotal], ["of which scrap cost", j.scrapCost], ["Actual per good unit", j.unitActual]] as [string, number][];
  return <Page title={`Cost of ${j.wo.number}`} crumbs={[["Costing", "/app/costing"], [j.wo.number]]} sub="Drill from each figure to its source movements below.">
    <Card><dl className="divide-y divide-line text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between py-2"><dt>{k}</dt><dd className="num font-medium">{formatINR(v)}</dd></div>)}</dl></Card>
    <Card title="Source: material movements" className="mt-4"><DataTable rows={d.issues} empty="No material issued." cols={[{ h: "#", r: (r: any) => r.seq, num: true }, { h: "Item", r: (r: any) => r.code }, { h: "Kind", r: (r: any) => r.kind }, { h: "Qty", r: (r: any) => Number(r.qty), num: true }, { h: "Unit cost", r: (r: any) => formatINR(r.unit_cost_paise), num: true }]} /></Card>
    <Card title="Corrections" className="mt-4"><DataTable rows={d.adj} empty="No corrections." cols={[{ h: "When", r: (r: any) => dt(r.created_at) }, { h: "Period", r: (r: any) => r.period }, { h: "Amount", r: (r: any) => formatINR(r.amount_paise), num: true }, { h: "Reason", r: (r: any) => r.reason }]} />
      {can(a.membership.role, "cost.adjust") && <ActionForm action={costAdjustAction} submit="Post correction" className="mt-3" resetOnOk><Hidden name="id" value={id} /><Grid cols={3}><Field label="Direction" name="dir" options={[{ value: "debit", label: "Add cost" }, { value: "credit", label: "Reduce cost" }]} defaultValue="debit" required /><Field label="Amount (₹)" name="amount" required placeholder="500.00" /><Field label="Reason" name="reason" required /></Grid></ActionForm>}</Card><Note>Corrections are posted to the current open period; closed periods are never rewritten.</Note></Page>;
}
