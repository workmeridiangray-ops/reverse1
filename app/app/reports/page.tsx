import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, A, Stat, Note, LinkBtn, fmt, date } from "@/components/ui";
import { can } from "@/lib/server/perms";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Reports" };
export default async function P() {
  const a = await requireCompany("report.read"); const costOk = can(a.membership.role, "cost.read");
  const d = await rd(a, async (c) => ({
    short: (await c.query(`select i.id, i.code, i.name, coalesce(sum(m.planned_qty - m.issued_qty),0) need, coalesce((select sum(b.qty) from stock_balances b join locations l on l.id=b.location_id left join batches ba on ba.id=b.batch_id where b.item_id=i.id and l.kind='stock' and (ba.id is null or ba.status='available')),0) avail from wo_materials m join work_orders w on w.id=m.work_order_id and w.status in ('released','in_progress') join items i on i.id=m.item_id group by i.id having sum(m.planned_qty - m.issued_qty) > 0 order by i.code`)).rows,
    adh: (await c.query(`select count(*) filter (where completed_at <= due_date)::int ontime, count(*)::int total from (select w.due_date, (select max(o.actual_end)::date from wo_operations o where o.work_order_id=w.id) completed_at from work_orders w where w.status in ('completed','closed')) x`)).rows[0],
    yieldr: (await c.query("select i.code, sum(w.completed_qty) good, sum(w.scrap_qty) scrap from work_orders w join items i on i.id=w.item_id where w.status in ('in_progress','completed','closed') group by i.code order by i.code")).rows,
    supp: (await c.query(`select s.name, count(l.*)::int lines, sum(case when l.received_qty >= l.qty then 1 else 0 end)::int complete from purchase_order_lines l join purchase_orders p on p.id=l.po_id join suppliers s on s.id=p.supplier_id where p.status in ('approved','partial','received') group by s.name`)).rows,
    late: (await c.query("select w.id, w.number, i.code, w.due_date from work_orders w join items i on i.id=w.item_id where w.status in ('planned','released','in_progress') and w.due_date < current_date order by w.due_date")).rows,
    margin: costOk ? (await c.query(`select w.number, w.id, l.qty, w.completed_qty from work_orders w join sales_order_lines l on l.id=w.so_line_id where w.status in ('completed','closed')`)).rows : [] }));
  return <Page title="Plant dashboard & reports" sub="Metric definitions are stated under each report. Every row drills to its source record." actions={<LinkBtn href="/api/export/stock">Export stock CSV</LinkBtn>}>
    <div className="grid gap-3 sm:grid-cols-3"><Stat label="Late open jobs" value={d.late.length} tone={d.late.length ? "text-danger" : ""} /><Stat label="Schedule adherence" value={d.adh.total ? `${Math.round((d.adh.ontime / d.adh.total) * 100)}%` : "—"} /><Stat label="Material shortages" value={d.short.length} tone={d.short.length ? "text-warn" : ""} /></div>
    <p className="mt-1 text-xs text-muted">Schedule adherence = completed jobs whose last operation ended on or before the due date ÷ all completed jobs.</p>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <Card title="Shortages against released jobs"><DataTable rows={d.short} empty="No shortages." cols={[{ h: "Item", r: (r: any) => <A href={`/app/items/${r.id}`}>{r.code}</A> }, { h: "Still needed", r: (r: any) => fmt(r.need, 3), num: true }, { h: "Available", r: (r: any) => fmt(r.avail, 3), num: true }, { h: "Short", r: (r: any) => <span className="text-danger">{fmt(Math.max(0, r.need - r.avail), 3)}</span>, num: true }]} /></Card>
      <Card title="Yield & scrap by item"><DataTable rows={d.yieldr} empty="No output yet." cols={[{ h: "Item", r: (r: any) => r.code }, { h: "Good", r: (r: any) => fmt(r.good), num: true }, { h: "Scrap", r: (r: any) => fmt(r.scrap), num: true }, { h: "Yield %", r: (r: any) => (Number(r.good) + Number(r.scrap) > 0 ? fmt((Number(r.good) / (Number(r.good) + Number(r.scrap))) * 100, 1) : "—"), num: true }]} /><p className="mt-2 text-xs text-muted">Yield = good ÷ (good + scrap).</p></Card>
      <Card title="Supplier delivery (lines fully received)"><DataTable rows={d.supp} empty="No purchase activity." cols={[{ h: "Supplier", r: (r: any) => r.name }, { h: "Lines", r: (r: any) => r.lines, num: true }, { h: "Complete", r: (r: any) => r.complete, num: true }]} /></Card>
      <Card title="Late jobs"><DataTable rows={d.late} empty="None." cols={[{ h: "Job", r: (r: any) => <A href={`/app/production/${r.id}`}>{r.number}</A> }, { h: "Item", r: (r: any) => r.code }, { h: "Due", r: (r: any) => date(r.due_date) }]} /></Card>
    </div><Note>Job margin and WIP values are on the <A href="/app/costing">Job costing</A> page (finance roles).</Note></Page>;
}
void formatINR;
