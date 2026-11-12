import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Alert, Field, Empty, fmtDate } from '@/components/ui';
import ActionForm, { ConfirmButton, ReasonForm } from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { scheduleCheck, materialNeeds } from '@/lib/domain/planning';
import { addDependencyAction, removeDependencyAction, rescheduleAction, approveBaselineAction } from '@/app/actions/project';
import { progressBp } from '@/lib/rules/schedule';
import { milli } from '@/lib/domain/common';
import { formatQty } from '@/lib/rules/money';
export const metadata = { title: 'Schedule · Buildline' };
export default async function Schedule({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('planning:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => ({ p: await projectOrNotFound(q, projectId), chk: await scheduleCheck(q, projectId), deps: await many<any>(q, `select d.*, a.code pc, b.code sc from activity_deps d join activities a on a.id = d.pred_id join activities b on b.id = d.succ_id where d.project_id = $1`, [projectId]), bl: await many<any>(q, 'select baseline_no, note, approved_at from schedule_baselines where project_id = $1 order by baseline_no desc', [projectId]), needs: await materialNeeds(q, projectId), full: await many<any>(q, 'select * from activities where project_id = $1', [projectId]) }));
  const byId = new Map(d.full.map((a: any) => [a.id, a])); const canEdit = perms.has('planning:edit');
  return (
    <>
      <PageHeader title="Schedule" sub="Activities, dependencies and an approved baseline. Updates are compared with the baseline; history is never rewritten." actions={<>{perms.has('planning:create') && <Link href={`/p/${projectId}/e/activities/new`} className="btn btn-primary">New activity</Link>}<Link href={`/p/${projectId}/e/resources`} className="btn">Resource plan</Link></>} />
      {d.chk.violations.length > 0 && <div className="mb-4"><Alert kind="warn" title={`${d.chk.violations.length} dependency conflict(s)`}>{d.chk.violations.map((v: any) => `${(byId.get(v.succ) as any).code} starts before ${(byId.get(v.pred) as any).code} finishes (earliest ${fmtDate(v.earliestStart)})`).join('; ')}. Reschedule manually or change the link.</Alert></div>}
      <Table head={[{ label: 'Activity' }, { label: 'Start', hideSm: true }, { label: 'Finish' }, { label: 'vs baseline', hideSm: true }, { label: 'Progress', num: true }, { label: 'Status' }]} empty={<Empty title="No activities yet">Add activities, link them with dependencies, then approve a baseline.</Empty>}>
        {d.chk.acts.map((a: any) => { const full: any = byId.get(a.id); return (
          <tr key={a.id}><Td><Link href={`/p/${projectId}/e/activities/${a.id}`}>{a.code}</Link><div className="text-xs text-muted">{a.name}</div></Td><Td hideSm>{fmtDate(a.s)}</Td><Td>{fmtDate(a.f)}</Td>
            <Td hideSm>{a.variance === null ? 'No baseline' : a.variance === 0 ? 'On baseline' : a.variance > 0 ? <span className="text-bad">{a.variance} day(s) late</span> : <span className="text-ok">{-a.variance} day(s) early</span>}</Td>
            <Td num>{Math.round(progressBp(full.measure_rule, milli(full.done_qty), milli(full.planned_qty), full.status === 'complete') / 100)}%</Td><Td><Badge status={a.status} />{full.requires_hold_release && <div className="text-xs text-warn">hold point</div>}</Td></tr>); })}
      </Table>
      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <Card title="Dependencies (finish-to-start)">
          <ul className="divide-y divide-line mb-3">{d.deps.map((x: any) => <li key={x.id} className="py-2 flex justify-between items-center gap-3 text-sm"><span>{x.pc} → {x.sc}{x.lag_days ? ` (lag ${x.lag_days}d)` : ''}</span>{canEdit && <ConfirmButton action={removeDependencyAction.bind(null, x.id)} label="Remove" confirmText="Remove this link?" />}</li>)}</ul>
          {d.deps.length === 0 && <p className="text-sm text-muted mb-3">No links yet.</p>}
          {canEdit && d.full.length > 1 && <ActionForm action={addDependencyAction.bind(null, projectId)} submit="Add link" resetOnSuccess>
            <div className="grid sm:grid-cols-3 gap-3"><Field label="Predecessor" name="pred_id"><select id="pred_id" name="pred_id" className="input" required><option value="">Choose…</option>{d.full.map((a: any) => <option key={a.id} value={a.id}>{a.code}</option>)}</select></Field><Field label="Successor" name="succ_id"><select id="succ_id" name="succ_id" className="input" required><option value="">Choose…</option>{d.full.map((a: any) => <option key={a.id} value={a.id}>{a.code}</option>)}</select></Field><Field label="Lag (days)" name="lag_days"><input id="lag_days" name="lag_days" defaultValue="0" inputMode="numeric" className="input" /></Field></div></ActionForm>}
        </Card>
        <Card title="Baseline">
          {d.bl.length ? <ul className="mb-3 text-sm">{d.bl.map((b: any) => <li key={b.baseline_no}>Version {b.baseline_no} — {fmtDate(b.approved_at)}{b.note ? ` · ${b.note}` : ''}</li>)}</ul> : <p className="text-sm text-muted mb-3">No baseline approved yet.</p>}
          {perms.has('planning:approve') && <ActionForm action={approveBaselineAction.bind(null, projectId)} submit={d.bl.length ? 'Approve new baseline version' : 'Approve baseline'}><Field label="Note" name="note"><input id="note" name="note" className="input" placeholder="e.g. Re-baselined after variation VO-2" /></Field></ActionForm>}
          {canEdit && d.full.length > 0 && <div className="mt-5 border-t border-line pt-4"><h3 className="mb-2">Reschedule an activity</h3>
            <ActionForm action={async (p: any, fd: FormData) => { 'use server'; const { rescheduleAction: r } = await import('@/app/actions/project'); return r(String(fd.get('activity')), p, fd); }} submit="Update dates">
              <Field label="Activity" name="activity"><select id="activity" name="activity" className="input" required><option value="">Choose…</option>{d.full.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="New start" name="start"><input id="start" name="start" type="date" className="input" required /></Field><Field label="New finish" name="finish"><input id="finish" name="finish" type="date" className="input" required /></Field></div>
              <Field label="Reason (recorded as the delay reason)" name="reason"><input id="reason" name="reason" className="input" required minLength={3} /></Field></ActionForm></div>}
        </Card>
      </div>
      <Card title="Material needs by activity" className="mt-6">
        <Table head={[{ label: 'Activity' }, { label: 'Material' }, { label: 'Requested', num: true }, { label: 'Ordered', num: true }, { label: 'Received (accepted)', num: true }]} empty={<Empty title="No material requests linked to activities">Link a material request to an activity to see needs here.</Empty>}>
          {d.needs.map((n: any, i: number) => <tr key={i}><Td>{n.code}<div className="text-xs text-muted">starts {fmtDate(n.start_date)}</div></Td><Td>{n.item_code}</Td><Td num>{formatQty(milli(n.requested))} {n.unit}</Td><Td num>{formatQty(milli(n.ordered))}</Td><Td num>{formatQty(milli(n.received))}</Td></tr>)}
        </Table>
      </Card>
    </>
  );
}
