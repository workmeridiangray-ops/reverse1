import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText } from "@/components/ui/Format";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { addDrawing, addRevision, approveRevision, closeRfi, raiseRfi, respondRfi } from "./actions";

export const metadata = { title: "Drawings & RFIs" };
export default async function Drawings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("drawing.view");
  const { p, drawings, revs, rfis } = await c.run(async (db) => ({
    p: await getProject(db, id),
    drawings: await db.q<{ id: string; number: string; title: string; discipline: string }>("SELECT id,number,title,discipline FROM drawings WHERE project_id=$1 ORDER BY number", [id]),
    revs: await db.q<{ id: string; drawing_id: string; rev: string; status: string; file_id: string; note: string | null; uploaded_by: string | null; approved_at: Date | null; downloads: number }>(
      "SELECT r.id,r.drawing_id,r.rev,r.status,r.file_id,r.note,r.uploaded_by,r.approved_at,(SELECT count(*) FROM drawing_distribution d WHERE d.revision_id=r.id)::int downloads FROM drawing_revisions r WHERE r.project_id=$1 ORDER BY r.created_at DESC", [id]),
    rfis: await db.q<{ id: string; number: number; question: string; decision_needed: string; due_date: string; status: string; response: string | null; dnum: string | null; overdue: boolean }>(
      "SELECT r.id,r.number,r.question,r.decision_needed,r.due_date,r.status,r.response,d.number dnum,(r.status='open' AND r.due_date < current_date) overdue FROM rfis r LEFT JOIN drawings d ON d.id=r.drawing_id WHERE r.project_id=$1 ORDER BY r.number DESC", [id]),
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const manage = c.can("drawing.manage") && p.status !== "closed";
  return (
    <>
      <PageHeader eyebrow={p.code} title="Drawings and RFIs" description="Only the approved revision is current for site execution. Earlier revisions are kept and marked superseded; every download is logged." />
      <ProjectTabs c={c} id={id} active="drawings" />
      <Card title="Drawing register">
        {drawings.length === 0 ? <EmptyState title="No drawings yet">{manage ? "Upload the first drawing below." : "Approved drawings will appear here."}</EmptyState> : (
          <ul className="divide-y divide-line">
            {drawings.map((d) => {
              const rs = revs.filter((r) => r.drawing_id === d.id);
              const cur = rs.find((r) => r.status === "approved");
              return (
                <li key={d.id} className="py-4">
                  <p className="font-bold">{d.number} — {d.title} <span className="font-normal text-ink-500">({d.discipline})</span></p>
                  {!cur ? <div className="mt-2"><Alert tone="warn" title="No approved revision">Do not use for site execution until a revision is approved.</Alert></div> : null}
                  <ul className="mt-2 space-y-2">{rs.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3">
                      <Badge status={r.status === "approved" ? "current" : r.status} /> <span className="font-bold">Rev {r.rev}</span>
                      <a href={`/api/files/${r.file_id}`} target="_blank" rel="noreferrer">{r.status === "superseded" ? "Open (SUPERSEDED — not for construction)" : "Open"}</a>
                      <span className="text-caption text-ink-500">{r.downloads} view(s){r.approved_at ? <> · approved <DateText at={r.approved_at} /></> : null}</span>
                      {r.status === "draft" && c.can("drawing.approve") && p.status !== "closed" ? (r.uploaded_by === c.user.id ? <span className="text-sm text-warn-fg">Uploaded by you — another person must approve</span> : <ActionForm action={approveRevision} submitLabel="Approve as current" variant="secondary">{hid}<input type="hidden" name="revision_id" value={r.id} /></ActionForm>) : null}
                    </li>))}</ul>
                  {manage ? <details className="mt-2"><summary className="cursor-pointer text-sm font-bold">Upload a new revision…</summary>
                    <ActionForm action={addRevision} submitLabel="Upload revision" pendingLabel="Uploading…" reset>{hid}<input type="hidden" name="drawing_id" value={d.id} /><TextField label="Revision" name="rev" id={`rev-${d.id}`} placeholder="B" /><TextField label="Change note" name="note" id={`note-${d.id}`} optional />
                      <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required aria-label="Drawing file" className="min-h-touch rounded border border-ink-500 bg-surface p-2" /></ActionForm></details> : null}
                </li>);
            })}
          </ul>
        )}
      </Card>
      {manage ? (
        <Card title="Add a drawing" className="mt-6"><ActionForm action={addDrawing} submitLabel="Upload drawing" pendingLabel="Uploading…" reset className="max-w-xl">
          {hid}<div className="grid gap-4 sm:grid-cols-2"><TextField label="Drawing number" name="number" placeholder="A-101" /><TextField label="First revision" name="rev" id="first-rev" placeholder="A" /></div>
          <TextField label="Title" name="title" /><SelectField label="Discipline" name="discipline"><option value="architectural">Architectural</option><option value="structural">Structural</option><option value="mep">MEP</option><option value="civil">Civil</option><option value="general">General</option></SelectField>
          <TextField label="Note" name="note" id="first-note" optional />
          <label htmlFor="dfile" className="text-sm font-bold">File (PDF, PNG, JPEG or WebP, up to 15 MB)</label><input id="dfile" name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required className="min-h-touch rounded border border-ink-500 bg-surface p-2" />
        </ActionForm></Card>
      ) : null}
      <h2 className="mb-3 mt-10 text-heading font-bold">Requests for information</h2>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {rfis.length === 0 ? <EmptyState title="No RFIs" /> : rfis.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">RFI-{r.number}{r.dnum ? ` · drawing ${r.dnum}` : ""}</h3><span className="flex items-center gap-2">{r.overdue ? <Badge visual={{ label: "Overdue", tone: "danger", icon: "alert" }} /> : null}<Badge status={r.status} /></span></div>
              <p className="mt-1">{r.question}</p><p className="mt-1 text-sm text-ink-700">Decision needed: {r.decision_needed} · due <DateText at={r.due_date} /></p>
              {r.response ? <p className="mt-2 rounded bg-ok-bg p-2 text-sm text-ok-fg">Response: {r.response}</p> : null}
              {r.status === "open" && c.can("rfi.respond") && p.status !== "closed" ? <ActionForm action={respondRfi} submitLabel="Send response" reset>{hid}<input type="hidden" name="rfi_id" value={r.id} /><TextAreaField label="Response" name="response" id={`resp-${r.id}`} /></ActionForm> : null}
              {r.status === "answered" && c.can("rfi.raise") && p.status !== "closed" ? <ActionForm action={closeRfi} submitLabel="Close RFI" variant="secondary">{hid}<input type="hidden" name="rfi_id" value={r.id} /></ActionForm> : null}
            </Card>))}
        </div>
        {c.can("rfi.raise") && p.status !== "closed" ? (
          <Card title="Raise an RFI"><ActionForm action={raiseRfi} submitLabel="Raise RFI" reset>{hid}
            <SelectField label="Drawing" name="drawing_id" optional><option value="">None</option>{drawings.map((d) => <option key={d.id} value={d.id}>{d.number}</option>)}</SelectField>
            <TextField label="Location" name="location" optional /><TextAreaField label="Question" name="question" /><TextField label="Decision required" name="decision_needed" /><TextField label="Response due" name="due_date" type="date" /></ActionForm></Card>
        ) : null}
      </div>
    </>
  );
}
