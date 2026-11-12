import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Money, Alert, Field, Stat, DL, fmtDate } from '@/components/ui';
import ActionForm, { ConfirmButton, ReasonForm } from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { completionStatus } from '@/lib/domain/handover';
import { projectFinalAccount } from '@/lib/domain/billing';
import * as A from '@/app/actions/project';
export const metadata = { title: 'Handover & closure · Buildline' };
export default async function Handover({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('handover:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { const p = await projectOrNotFound(q, projectId); return { p, st: await completionStatus(q, projectId), cl: await many<any>(q, 'select * from completion_checklist where project_id=$1 order by created_at', [projectId]), fa: await projectFinalAccount(q, projectId), faRow: await one<any>(q, 'select * from final_accounts where project_id=$1', [projectId]),
    files: await many<any>(q, `select id, name, created_at from files where project_id=$1 and kind='export' order by created_at desc limit 5`, [projectId]) }; });
  const { p } = d; const can = perms.has('handover:approve');
  return (<>
    <PageHeader title="Handover & closure" sub="Snags, completion checklist, final account, defect period and archive." />
    {p.status === 'active' && can && <Card className="mb-6"><ActionForm action={A.startHandoverAction.bind(null, projectId)} submit="Start handover"><p className="text-sm text-muted">Creates the completion checklist and moves the project to handover.</p></ActionForm></Card>}
    <div className="grid sm:grid-cols-4 gap-4 mb-6"><Stat label="Open snags" value={d.st.openSnags} sub={<Link href={`/p/${projectId}/e/snags`}>Snag list</Link>} /><Stat label="Checklist open" value={`${d.st.checklistOpen} / ${d.st.checklistTotal}`} /><Stat label="Final account" value={d.faRow?.status ?? 'not prepared'} /><Stat label="Defect period ends" value={p.dlp_end ? fmtDate(p.dlp_end) : '—'} sub="Reminder only; does not settle liability" /></div>
    {d.cl.length > 0 && <Card title="Completion checklist" className="mb-6"><ul className="divide-y divide-line">{d.cl.map((c: any) => <li key={c.id} className="py-3 flex flex-wrap gap-3 justify-between items-start"><span>{c.done ? '✔' : '○'} {c.item}{c.evidence && <span className="block text-xs text-muted">Evidence: {c.evidence}</span>}</span>
      {perms.has('handover:edit') && !['closed'].includes(p.status) && (c.done ? <ConfirmButton action={A.toggleChecklistAction.bind(null, c.id)} label="Reopen" confirmText="Mark this item as not done?" hidden={{ done: '0' }} /> : <ActionForm action={A.toggleChecklistAction.bind(null, c.id)} submit="Mark done" submitClass="btn btn-sm"><input type="hidden" name="done" value="1" /><input name="evidence" aria-label="Evidence" placeholder="Evidence / reference" className="input" required minLength={3} /></ActionForm>)}</li>)}</ul></Card>}
    <Card title="Final account" className="mb-6">
      {d.fa ? <><DL items={[['Revised contract value', <Money v={d.fa.revisedValue} />], ['Unbilled', <Money v={d.fa.unbilled} />], ['Advance not yet recovered', <Money v={d.fa.advanceUnrecovered} />], ['Retention held', <Money v={d.fa.retentionHeld} />], ['Receivable', <Money v={d.fa.receivable} />], ['Open disputes', <Money v={d.fa.openDisputes} />], ['Variations pending', <Money v={d.fa.pendingVariations} />]]} />
        {d.fa.blockers.length > 0 && <div className="mt-3"><Alert kind="warn" title="Outstanding items">{d.fa.blockers.join(' · ')}</Alert></div>}</> : <p className="text-sm text-muted">No active contract on this project.</p>}
      <div className="flex flex-wrap gap-2 mt-4">{perms.has('handover:edit') && d.fa && <ConfirmButton action={A.prepareFinalAccountAction.bind(null, projectId)} label="Recalculate" confirmText="Recalculate the final account from current records?" />}
        {can && d.fa && d.faRow?.status !== 'agreed' && <ReasonForm action={A.agreeFinalAccountAction.bind(null, projectId)} label="Agree final account" reasonLabel="Reason (required only if items are outstanding)" />}</div>
    </Card>
    {p.status === 'handover' && can && <Card title="Practical completion" className="mb-6"><ActionForm action={A.startDefectPeriodAction.bind(null, projectId)} submit="Start defect period"><Field label="Completion date" name="completion_date" required><input id="completion_date" name="completion_date" type="date" className="input" required /></Field><p className="help">Needs all snags verified and the checklist complete. Defect period = {p.dlp_months} months.</p></ActionForm></Card>}
    {['handover', 'defect_period'].includes(p.status) && can && <Card title="Close project" className="mb-6"><ConfirmButton action={A.closeProjectAction.bind(null, projectId)} label="Close project" confirmText="Close this project? All records become read-only." className="btn btn-danger" /><p className="help mt-2">Requires verified snags, a complete checklist, an agreed final account and no outstanding invoices.</p></Card>}
    <Card title="Archive & export"><p className="text-sm text-muted mb-3">A ZIP of CSVs for the project's BOQ, bills, invoices, receipts, drawings, RFIs, snags and audit trail.</p>
      {perms.has('reports:export') && <ConfirmButton action={A.requestExportAction.bind(null, projectId)} label="Prepare export package" confirmText="Prepare the export package now?" className="btn btn-primary" />}
      <ul className="mt-3 text-sm">{d.files.map((f: any) => <li key={f.id}><a href={`/api/files/${f.id}`}>{f.name}</a> <span className="text-muted">{fmtDate(f.created_at)}</span></li>)}</ul><p className="help mt-2">Warranties: <Link href={`/p/${projectId}/e/warranties`}>register</Link>. As-built documents: attach to the relevant drawing or snag.</p></Card>
  </>);
}
