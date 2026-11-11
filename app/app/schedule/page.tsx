import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, A, Badge, Field, Hidden, Note, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { rescheduleAction } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Schedule & load" };
export default async function P() {
  const a = await requireCompany("prod.read");
  const d = await rd(a, async (c) => ({
    load: (await c.query(`select w.code, w.hours_per_day, coalesce(sum(o.planned_min - least(o.actual_min, o.planned_min)),0)/60 hours_open, count(o.id) ops from work_centres w left join wo_operations o on o.work_centre_id=w.id and o.status<>'done' left join work_orders j on j.id=o.work_order_id and j.status in ('released','in_progress') group by w.id order by w.code`)).rows,
    ops: (await c.query(`select o.*, w.code wc, j.number, j.id jid, i.code item, (select 1 from wo_operations p where p.work_order_id=o.work_order_id and p.seq<o.seq and p.planned_end >= o.planned_start limit 1) conflict from wo_operations o join work_centres w on w.id=o.work_centre_id join work_orders j on j.id=o.work_order_id join items i on i.id=j.item_id where o.status<>'done' and j.status in ('released','in_progress') order by o.planned_start, j.number, o.seq limit 100`)).rows }));
  const w = can(a.membership.role, "prod.write");
  return <Page title="Capacity & job board" sub="Manual scheduling with dependency checks. Rescheduling keeps the previous dates in the schedule history.">
    <Note>Baseline scheduling is manual and does not promise an optimal schedule.</Note>
    <Card title="Work-centre load (open hours vs daily capacity)"><DataTable rows={d.load} cols={[{ h: "Work centre", r: (r: any) => r.code }, { h: "Open operations", r: (r: any) => r.ops, num: true }, { h: "Open hours", r: (r: any) => fmt(r.hours_open, 1), num: true }, { h: "Days of work", r: (r: any) => fmt(Number(r.hours_open) / Number(r.hours_per_day), 1), num: true }]} /></Card>
    <h2 className="mb-2 mt-6 font-semibold">Dispatch list</h2>
    <DataTable rows={d.ops} empty="No open operations. Release a work order first." cols={[{ h: "Job", r: (r: any) => <A href={`/app/production/${r.jid}`}>{r.number}</A> }, { h: "Item", r: (r: any) => r.item, hideSm: true }, { h: "Seq / operation", r: (r: any) => `${r.seq} ${r.name}` }, { h: "Work centre", r: (r: any) => r.wc }, { h: "Planned", r: (r: any) => `${date(r.planned_start)} → ${date(r.planned_end)}` }, { h: "Status", r: (r: any) => <>{<Badge s={r.status} />}{r.conflict ? <span className="ml-1 text-danger">⚠ conflict</span> : null}</> },
      ...(w ? [{ h: "Reschedule", r: (r: any) => <details><summary className="cursor-pointer text-brand">Change</summary><ActionForm action={rescheduleAction} submit="Save" small className="mt-2 w-64"><Hidden name="id" value={r.id} /><Field label="Start" name="start" type="date" required defaultValue={String(r.planned_start)} /><Field label="End" name="end" type="date" required defaultValue={String(r.planned_end)} /><Field label="Reason" name="reason" required /></ActionForm></details> }] : [])]} /></Page>;
}
