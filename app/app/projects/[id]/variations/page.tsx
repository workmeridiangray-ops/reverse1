import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Money, Qty } from "@/components/ui/Format";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { createVariation, decideVariation, submitVariation } from "./actions";

export const metadata = { title: "Variations" };
export default async function Variations({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("project.view");
  const { p, items, rows } = await c.run(async (db) => ({
    p: await getProject(db, id),
    items: await db.q<{ id: string; code: string; description: string; unit: string }>("SELECT id,code,description,unit FROM boq_items WHERE project_id=$1 ORDER BY code", [id]),
    rows: await db.q<{ id: string; number: number; title: string; description: string | null; code: string; unit: string; qty_delta_milli: number; cost_minor: number; time_days: number; status: string; decision_reason: string | null; requested_by: string | null }>(
      "SELECT v.id,v.number,v.title,v.description,b.code,b.unit,v.qty_delta_milli,v.cost_minor,v.time_days,v.status,v.decision_reason,v.requested_by FROM variations v JOIN boq_items b ON b.id=v.boq_item_id WHERE v.project_id=$1 ORDER BY v.number DESC", [id]),
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const canDecide = c.can("variation.approve") || c.can("variation.decide");
  const open = p.status === "active" || p.status === "handover";
  return (
    <>
      <PageHeader eyebrow={p.code} title="Variations" description="Scope, cost and time changes. Quantities change at the original contract rate; approval needs a different person and rejection needs a reason." />
      <ProjectTabs c={c} id={id} active="variations" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {rows.length === 0 ? <EmptyState title="No variations">Raise a variation when work exceeds or changes the contract quantity.</EmptyState> : rows.map((v) => (
            <Card key={v.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-title font-bold">V{v.number}: {v.title}</h2><Badge status={v.status} /></div>
              {v.description ? <p className="mt-1 text-ink-700">{v.description}</p> : null}
              <p className="mt-2 text-sm">Item {v.code}: <Qty milli={v.qty_delta_milli} unit={v.unit} /> · cost impact <Money minor={v.cost_minor} /> · time {v.time_days >= 0 ? "+" : ""}{v.time_days} days</p>
              {v.decision_reason ? <p className="mt-1 text-sm text-ink-700">Decision note: {v.decision_reason}</p> : null}
              {v.status === "draft" && c.can("variation.request") && open ? <ActionForm action={submitVariation} submitLabel="Submit for approval">{hid}<input type="hidden" name="variation_id" value={v.id} /></ActionForm> : null}
              {v.status === "submitted" && canDecide && open ? (
                v.requested_by === c.user.id ? <p className="mt-3 text-sm text-warn-fg">You raised this variation; someone else must decide it.</p> : (
                  <div className="mt-3 flex flex-wrap gap-6">
                    <ActionForm action={decideVariation} submitLabel="Approve">{hid}<input type="hidden" name="variation_id" value={v.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                    <details><summary className="cursor-pointer font-bold text-danger-fg">Reject…</summary><ActionForm action={decideVariation} submitLabel="Reject" variant="secondary">{hid}<input type="hidden" name="variation_id" value={v.id} /><input type="hidden" name="decision" value="reject" /><TextField label="Reason" name="reason" id={`vr-${v.id}`} /></ActionForm></details>
                  </div>)
              ) : null}
            </Card>
          ))}
        </div>
        {c.can("variation.request") && open ? (
          <Card title="Raise a variation">
            <ActionForm action={createVariation} submitLabel="Save draft" reset>
              {hid}<TextField label="Title" name="title" />
              <SelectField label="Affected BOQ item" name="boq_item_id"><option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}</SelectField>
              <TextField label="Quantity change" name="qty_delta" inputMode="decimal" hint="Use a minus sign for omissions, e.g. -25.5" />
              <TextField label="Time impact (days)" name="time_days" inputMode="numeric" defaultValue="0" optional />
              <TextAreaField label="Description" name="description" optional />
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
