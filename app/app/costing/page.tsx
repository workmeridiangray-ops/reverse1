import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, A, Badge, Field, Grid, Note, LinkBtn } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { closePeriodAction } from "../actions";
import { jobCostFor } from "@/lib/server/svc/costing";
import { formatINR } from "@/lib/domain/money";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Job costing" };
export default async function P() {
  const a = await requireCompany("cost.read");
  const d = await rd(a, async (c) => { const wos = (await c.query("select w.id, w.number, i.code, w.status from work_orders w join items i on i.id=w.item_id where w.status in ('in_progress','completed','closed') order by w.created_at desc limit 40")).rows;
    const rows = []; for (const w of wos) { const j = await jobCostFor(c, w.id); rows.push({ ...w, ...j }); } const wip = rows.filter((r: any) => ["released", "in_progress"].includes(r.wo.status));
    const fg = (await c.query(`select i.code, i.std_cost_paise, sum(b.qty) q from stock_balances b join items i on i.id=b.item_id join locations l on l.id=b.location_id where i.kind <> 'buy' and l.kind='stock' group by i.code, i.std_cost_paise order by i.code`)).rows;
    const raw = (await c.query(`select i.code, sum(b.qty) q, coalesce((select sum(m.qty*m.unit_cost_paise)/nullif(sum(m.qty),0) from stock_movements m where m.item_id=b.item_id and m.qty>0 and m.unit_cost_paise>0), i.std_cost_paise) unit from stock_balances b join items i on i.id=b.item_id join locations l on l.id=b.location_id where i.kind = 'buy' and l.kind='stock' group by i.code, b.item_id, i.std_cost_paise order by i.code`)).rows;
    return { rows, wip, fg, raw, periods: (await c.query("select * from cost_periods order by period desc")).rows }; });
  return <Page title="Job costing" sub="Operational method: material = issued qty × movement cost; labour = actual minutes × work-centre rate; overhead = labour × overhead %. Estimated, standard and actual are kept separate.">
    <Note>Finished goods are valued at standard cost; the difference to actual is the job variance (positive = adverse). Scrap cost stays in the job’s actual cost and is shown separately.</Note>
    <DataTable rows={d.rows} empty="No jobs have started yet." cols={[{ h: "Job", r: (r: any) => <A href={`/app/costing/${r.id}`}>{r.number}</A> }, { h: "Item", r: (r: any) => r.code, hideSm: true }, { h: "Material", r: (r: any) => formatINR(r.material), num: true }, { h: "Labour", r: (r: any) => formatINR(r.labour), num: true, hideSm: true }, { h: "Overhead", r: (r: any) => formatINR(r.overhead), num: true, hideSm: true }, { h: "Actual", r: (r: any) => formatINR(r.totalWithAdjustments), num: true }, { h: "Standard", r: (r: any) => formatINR(r.standardTotal), num: true, hideSm: true }, { h: "Variance", r: (r: any) => <span className={r.variance > 0 ? "text-danger" : "text-ok"}>{formatINR(r.variance)}</span>, num: true }]} />
    <div className="mt-5 grid gap-4 lg:grid-cols-3">
      <Card title="Work in progress (actual cost to date)"><DataTable rows={d.wip} empty="No jobs in progress." cols={[{ h: "Job", r: (r: any) => r.number }, { h: "Cost to date", r: (r: any) => formatINR(r.totalWithAdjustments), num: true }]} /><p className="mt-2 text-sm font-medium">Total WIP: {formatINR(d.wip.reduce((s: number, r: any) => s + r.totalWithAdjustments, 0))}</p></Card>
      <Card title="Finished goods & sub-assemblies (at standard)"><DataTable rows={d.fg} empty="No stock." cols={[{ h: "Item", r: (r: any) => r.code }, { h: "Qty", r: (r: any) => Number(r.q), num: true }, { h: "Value", r: (r: any) => formatINR(Math.round(Number(r.q) * Number(r.std_cost_paise))), num: true }]} /><p className="mt-2 text-sm font-medium">Total: {formatINR(d.fg.reduce((s: number, r: any) => s + Math.round(Number(r.q) * Number(r.std_cost_paise)), 0))}</p></Card>
      <Card title="Raw material (moving average)"><DataTable rows={d.raw} empty="No stock." cols={[{ h: "Item", r: (r: any) => r.code }, { h: "Qty", r: (r: any) => Number(r.q), num: true }, { h: "Value", r: (r: any) => formatINR(Math.round(Number(r.q) * Number(r.unit))), num: true }]} /><p className="mt-2 text-sm font-medium">Total: {formatINR(d.raw.reduce((s: number, r: any) => s + Math.round(Number(r.q) * Number(r.unit)), 0))}</p></Card></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2"><Card title="Accounting handoff"><p className="text-sm text-muted">Export job costs for your accounting system. Statutory books remain in your accounting software.</p><div className="mt-3"><LinkBtn href="/api/export/job-costs">Download CSV</LinkBtn></div></Card>
      <Card title="Cost periods">{d.periods.length ? <ul className="mb-3 text-sm">{d.periods.map((p: any) => <li key={p.period}>{p.period} — <Badge s={p.status === "closed" ? "closed" : "open"} /></li>)}</ul> : <p className="mb-3 text-sm text-muted">No periods closed.</p>}
        {can(a.membership.role, "cost.adjust") && <ActionForm action={closePeriodAction} submit="Close period" confirm="Close this period? Corrections will go to the next open period."><Field label="Period (YYYY-MM)" name="period" required placeholder={new Date().toISOString().slice(0, 7)} /></ActionForm>}</Card></div></Page>;
}
