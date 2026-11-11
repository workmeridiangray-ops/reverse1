import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextAreaField, TextField, CheckboxField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { decideInspection, raiseSnag, rectifySnag, requestInspection, verifySnag } from "./actions";

export const metadata = { title: "Quality & handover" };
export default async function Quality({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("project.view");
  const { p, items, insp, snags } = await c.run(async (db) => ({
    p: await getProject(db, id),
    items: await db.q<{ id: string; code: string }>("SELECT id,code FROM boq_items WHERE project_id=$1 ORDER BY code", [id]),
    insp: await db.q<{ id: string; number: number; title: string; location: string | null; hold_point: boolean; status: string; result_note: string | null; code: string | null }>("SELECT i.id,i.number,i.title,i.location,i.hold_point,i.status,i.result_note,b.code FROM inspections i LEFT JOIN boq_items b ON b.id=i.boq_item_id WHERE i.project_id=$1 ORDER BY i.number DESC", [id]),
    snags: await db.q<{ id: string; number: number; location: string; description: string; status: string; rectification_note: string | null; assigned_to: string | null }>("SELECT id,number,location,description,status,rectification_note,assigned_to FROM snags WHERE project_id=$1 ORDER BY number DESC", [id]),
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const live = p.status !== "closed";
  return (
    <>
      <PageHeader eyebrow={p.code} title="Quality, snags and handover" description="Inspections tie to a BOQ item; a failed or pending hold point blocks measurement verification for that item. A completed checklist records an observation, not a certificate." />
      <ProjectTabs c={c} id={id} active="quality" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="insp" className="space-y-4">
          <h2 id="insp" className="text-heading font-bold">Inspections</h2>
          {insp.length === 0 ? <EmptyState title="No inspections" /> : insp.map((i) => (
            <Card key={i.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">#{i.number} {i.title}</h3><span className="flex gap-2">{i.hold_point ? <Badge visual={{ label: "Hold point", tone: "warn", icon: "lock" }} /> : null}<Badge status={i.status} /></span></div>
              <p className="text-sm text-ink-700">{i.code ? `Item ${i.code}` : "General"}{i.location ? ` · ${i.location}` : ""}</p>{i.result_note ? <p className="text-sm">Note: {i.result_note}</p> : null}
              {i.status !== "passed" && c.can("measure.verify") && live ? (
                <div className="mt-3 flex flex-wrap gap-6"><ActionForm action={decideInspection} submitLabel="Pass">{hid}<input type="hidden" name="inspection_id" value={i.id} /><input type="hidden" name="decision" value="pass" /></ActionForm>
                  <details><summary className="cursor-pointer font-bold text-danger-fg">Fail…</summary><ActionForm action={decideInspection} submitLabel="Record failure" variant="secondary">{hid}<input type="hidden" name="inspection_id" value={i.id} /><input type="hidden" name="decision" value="fail" /><TextField label="What failed" name="note" id={`f-${i.id}`} /></ActionForm></details></div>) : null}
            </Card>))}
          {c.can("inspection.manage") && live ? (
            <Card title="Request an inspection"><ActionForm action={requestInspection} submitLabel="Request" reset>{hid}<TextField label="Title" name="title" id="insp-title" /><TextField label="Location" name="location" id="insp-location" optional />
              <SelectField label="BOQ item" name="boq_item_id" optional><option value="">None</option>{items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</SelectField>
              <TextField label="Drawing / revision reference" name="drawing_ref" optional /><CheckboxField label="Hold point" name="hold_point" hint="Blocks verification of measurements for this item until the inspection passes" /></ActionForm></Card>) : null}
        </section>
        <section aria-labelledby="snag" className="space-y-4">
          <h2 id="snag" className="text-heading font-bold">Snag list</h2>
          {snags.length === 0 ? <EmptyState title="No snags" /> : snags.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">#{s.number} · {s.location}</h3><Badge status={s.status} /></div>
              <p>{s.description}</p>{s.assigned_to ? <p className="text-sm text-ink-500">Assigned to {s.assigned_to}</p> : null}{s.rectification_note ? <p className="text-sm text-ink-700">Rectification: {s.rectification_note}</p> : null}
              {s.status === "open" && c.can("snag.manage") && live ? <ActionForm action={rectifySnag} submitLabel="Mark rectified" variant="secondary" reset>{hid}<input type="hidden" name="snag_id" value={s.id} /><TextField label="Rectification note" name="note" id={`rn-${s.id}`} /></ActionForm> : null}
              {s.status === "rectified" && c.can("measure.verify") && live ? <div className="mt-2 flex gap-4"><ActionForm action={verifySnag} submitLabel="Verify">{hid}<input type="hidden" name="snag_id" value={s.id} /><input type="hidden" name="decision" value="accept" /></ActionForm><ActionForm action={verifySnag} submitLabel="Reopen" variant="secondary">{hid}<input type="hidden" name="snag_id" value={s.id} /><input type="hidden" name="decision" value="reject" /></ActionForm></div> : null}
            </Card>))}
          {c.can("snag.manage") && live ? (
            <Card title="Raise a snag"><ActionForm action={raiseSnag} submitLabel="Raise snag" reset>{hid}<TextField label="Location" name="location" id="snag-location" /><TextAreaField label="Defect" name="description" id="snag-desc" /><TextField label="Assigned to" name="assigned_to" optional /></ActionForm></Card>) : null}
        </section>
      </div>
    </>
  );
}
