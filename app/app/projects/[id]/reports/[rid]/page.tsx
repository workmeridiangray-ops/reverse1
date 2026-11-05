import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText } from "@/components/ui/Format";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { reviewReport, saveReport, submitReport, uploadPhoto } from "../actions";

export const metadata = { title: "Daily report" };
interface R { id: string; report_date: string; weather: string | null; labour_count: number; equipment_hours: number; summary: string | null; issues: string | null; status: string; correction_reason: string | null; version: number; created_by: string | null }
export default async function ReportPage({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const c = await requireCtx("report.view");
  const data = await c.run(async (db) => {
    const p = await getProject(db, id);
    if (!/^[0-9a-f-]{36}$/i.test(rid)) return null;
    const r = await db.maybe<R>("SELECT id,report_date,weather,labour_count,equipment_hours::float equipment_hours,summary,issues,status,correction_reason,version,created_by FROM daily_reports WHERE id=$1 AND project_id=$2", [rid, id]);
    if (!r) return null;
    return { p, r, files: await db.q<{ id: string; name: string }>("SELECT id,name FROM files WHERE entity='daily_report' AND entity_id=$1 ORDER BY created_at", [rid]) };
  });
  if (!data) notFound();
  const { p, r, files } = data;
  const hid = <><input type="hidden" name="project_id" value={id} /><input type="hidden" name="report_id" value={r.id} /><input type="hidden" name="version" value={r.version} /></>;
  const editable = c.can("report.write") && (r.status === "draft" || r.status === "returned") && p.status !== "closed";
  return (
    <>
      <PageHeader eyebrow={p.code} title="Daily report" description={<span className="flex items-center gap-2"><DateText at={r.report_date} /> <Badge status={r.status} /></span>} />
      <ProjectTabs c={c} id={id} active="reports" />
      {r.correction_reason ? <div className="mb-4"><Alert tone="warn" title="Returned for correction">{r.correction_reason}</Alert></div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Report">
          {editable ? (
            <ActionForm action={saveReport} submitLabel="Save draft">
              {hid}<TextField label="Weather" name="weather" defaultValue={r.weather ?? ""} optional />
              <div className="grid gap-4 sm:grid-cols-2"><TextField label="Labour on site" name="labour_count" inputMode="numeric" defaultValue={String(r.labour_count)} /><TextField label="Equipment hours" name="equipment_hours" inputMode="decimal" defaultValue={String(r.equipment_hours)} /></div>
              <TextAreaField label="Work summary" name="summary" defaultValue={r.summary ?? ""} optional />
              <TextAreaField label="Issues / delays" name="issues" defaultValue={r.issues ?? ""} optional />
            </ActionForm>
          ) : <DefinitionList items={[["Weather", r.weather ?? "—"], ["Labour", r.labour_count], ["Equipment hours", r.equipment_hours], ["Summary", r.summary ?? "—"], ["Issues", r.issues ?? "—"]]} />}
        </Card>
        <div className="space-y-6">
          <Card title="Photos">
            <ul className="mb-3 space-y-1">{files.length === 0 ? <li className="text-ink-500">No photos.</li> : files.map((f) => <li key={f.id}><a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a></li>)}</ul>
            {editable ? <ActionForm action={uploadPhoto} submitLabel="Upload photo" pendingLabel="Uploading…" reset>{hid}<label htmlFor="photo" className="text-sm font-bold">Photo (JPEG, PNG or WebP, up to 15 MB)</label><input id="photo" name="file" type="file" accept="image/png,image/jpeg,image/webp" required className="min-h-touch rounded border border-ink-500 bg-surface p-2" /></ActionForm> : null}
          </Card>
          {editable ? <Card title="Submit"><ActionForm action={submitReport} submitLabel="Submit for review">{hid}<p className="text-ink-700">Save your draft first. Submitted reports are locked until reviewed.</p></ActionForm></Card> : null}
          {r.status === "submitted" && c.can("report.verify") ? (
            r.created_by === c.user.id ? <Alert tone="warn" title="You wrote this report">A different person must review it.</Alert> : (
              <Card title="Review"><div className="flex flex-col gap-4"><ActionForm action={reviewReport} submitLabel="Verify">{hid}<input type="hidden" name="decision" value="verify" /></ActionForm>
                <details><summary className="cursor-pointer font-bold">Return for correction…</summary><ActionForm action={reviewReport} submitLabel="Return" variant="secondary">{hid}<input type="hidden" name="decision" value="return" /><TextField label="What needs correcting" name="reason" /></ActionForm></details></div></Card>)
          ) : null}
        </div>
      </div>
    </>
  );
}
