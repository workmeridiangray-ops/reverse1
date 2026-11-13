import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText, todayIso } from "@/components/ui/Format";
import { SelectField, TextField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { inLookahead, slipDays } from "@/lib/rules/schedule";
import { addActivity, freezeBaseline, rescheduleActivity } from "./actions";

export const metadata = { title: "Schedule" };
interface A { id: string; wbs: string; name: string; s: string; e: string; bs: string | null; be: string | null; deps: string[]; delay_reason: string | null; version: number; code: string | null; done: number | null }
export default async function Schedule({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("plan.view");
  const { p, acts, items, bl } = await c.run(async (db) => ({
    p: await getProject(db, id),
    acts: await db.q<A>(`SELECT a.id,a.wbs,a.name,a.start_date::text s,a.end_date::text e,a.base_start::text bs,a.base_end::text be,a.depends_on deps,a.delay_reason,a.version,b.code,
        CASE WHEN a.boq_item_id IS NULL THEN NULL ELSE LEAST(100, ROUND(100.0 * COALESCE((SELECT sum(qty_milli) FROM measurements m WHERE m.boq_item_id=a.boq_item_id AND m.status='verified'),0) / NULLIF(b.qty_milli + COALESCE((SELECT sum(qty_delta_milli) FROM variations v WHERE v.boq_item_id=b.id AND v.status='approved'),0),0)))::int END done
      FROM schedule_activities a LEFT JOIN boq_items b ON b.id=a.boq_item_id WHERE a.project_id=$1 ORDER BY a.start_date, a.wbs`, [id]),
    items: await db.q<{ id: string; code: string }>("SELECT id,code FROM boq_items WHERE project_id=$1 ORDER BY code", [id]),
    bl: (await db.one<{ v: number }>("SELECT COALESCE(max(version),0)::int v FROM schedule_baselines WHERE project_id=$1", [id])).v,
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const edit = c.can("plan.edit") && p.status !== "closed";
  const today = todayIso();
  const look = acts.filter((a) => inLookahead({ start: a.s, end: a.e }, today));
  return (
    <>
      <PageHeader eyebrow={p.code} title="Schedule" description={`Baseline ${bl ? `v${bl} frozen` : "not frozen"}. Physical progress comes from verified measurements of the linked BOQ item, not from typed percentages.`} />
      <ProjectTabs c={c} id={id} active="schedule" />
      {acts.length === 0 ? <EmptyState title="No activities yet">{edit ? "Add the first activity below." : "The schedule has not been prepared."}</EmptyState> : (
        <Card title="Activities"><Table caption="Schedule activities"><thead><tr><Th>WBS</Th><Th>Activity</Th><Th>Planned</Th><Th>Baseline finish</Th><Th>Variance</Th><Th>Progress</Th>{edit ? <Th>Reschedule</Th> : null}</tr></thead>
          <tbody>{acts.map((a) => { const sl = slipDays({ end: a.e, baseEnd: a.be }); return (
            <tr key={a.id}><Td className="font-bold">{a.wbs}</Td><Td>{a.name}{a.deps.length ? <span className="block text-caption text-ink-500">after {a.deps.map((d) => acts.find((x) => x.id === d)?.wbs).join(", ")}</span> : null}{a.delay_reason ? <span className="block text-caption text-danger-fg">Delay: {a.delay_reason}</span> : null}</Td>
              <Td><DateText at={a.s} /> → <DateText at={a.e} /></Td><Td>{a.be ? <DateText at={a.be} /> : "—"}</Td>
              <Td>{a.be ? (sl > 0 ? <Badge visual={{ label: `+${sl} d`, tone: "danger", icon: "alert" }} /> : <Badge visual={{ label: sl === 0 ? "On baseline" : `${sl} d`, tone: "ok", icon: "check" }} />) : "—"}</Td>
              <Td>{a.done === null ? <span className="text-ink-500">not linked</span> : <span>{a.done}% <span className="text-caption text-ink-500">({a.code})</span></span>}</Td>
              {edit ? <Td><details><summary className="cursor-pointer text-sm font-bold">Change…</summary><ActionForm action={rescheduleActivity} submitLabel="Save dates" variant="secondary">{hid}<input type="hidden" name="activity_id" value={a.id} /><input type="hidden" name="version" value={a.version} />
                <TextField label="Start" name="start_date" id={`s-${a.id}`} type="date" defaultValue={a.s} /><TextField label="Finish" name="end_date" id={`e-${a.id}`} type="date" defaultValue={a.e} /><TextField label="Delay reason" name="delay_reason" id={`d-${a.id}`} optional hint="Required when finishing after the baseline" /></ActionForm></details></Td> : null}</tr>); })}</tbody></Table></Card>
      )}
      <Card title="Three-week lookahead" className="mt-6">{look.length === 0 ? <p className="text-ink-500">Nothing scheduled in the next three weeks.</p> : <ul className="space-y-1">{look.map((a) => <li key={a.id}><strong>{a.wbs}</strong> {a.name} — <DateText at={a.s} /> to <DateText at={a.e} /></li>)}</ul>}</Card>
      {edit ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="Add an activity"><ActionForm action={addActivity} submitLabel="Add activity" reset>{hid}
            <div className="grid gap-4 sm:grid-cols-2"><TextField label="WBS code" name="wbs" placeholder="1.2" /><TextField label="Activity" name="name" /></div>
            <div className="grid gap-4 sm:grid-cols-2"><TextField label="Start" name="start_date" id="new-start" type="date" /><TextField label="Finish" name="end_date" id="new-end" type="date" /></div>
            <SelectField label="Measure progress from BOQ item" name="boq_item_id" optional><option value="">Not linked</option>{items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</SelectField>
            <fieldset><legend className="text-sm font-bold">Predecessors (finish-to-start)</legend><div className="max-h-32 overflow-auto">{acts.map((a) => <label key={a.id} className="flex min-h-touch items-center gap-2"><input type="checkbox" name="depends_on" value={a.id} className="h-5 w-5" /> {a.wbs} {a.name}</label>)}</div></fieldset>
          </ActionForm></Card>
          <Card title="Baseline"><ActionForm action={freezeBaseline} submitLabel="Freeze baseline">{hid}<p className="text-ink-700">Snapshots current dates as the approved baseline. Later changes are shown as variance; the snapshot is never rewritten.</p><TextField label="Note" name="note" id="bl-note" optional /></ActionForm></Card>
        </div>
      ) : null}
    </>
  );
}
