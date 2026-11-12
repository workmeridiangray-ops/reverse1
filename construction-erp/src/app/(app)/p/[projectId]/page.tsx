import Link from 'next/link';
import { PageHeader, Card, Stat, Money, Badge, Table, Td, DL, fmtDate, Empty } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { financialPosition } from '@/lib/domain/billing';
import { updateProjectAction } from '@/app/actions/project';
import { progressBp } from '@/lib/rules/schedule';
import { milli } from '@/lib/domain/common';

export default async function Overview({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  const d = await withTenant(s.ctx, async q => {
    const p = await projectOrNotFound(q, projectId);
    const fin = perms.has('billing:view') ? await financialPosition(q, projectId) : null;
    const acts = await many<any>(q, `select a.*, b.rate_paise from activities a left join boq_items b on b.id = a.boq_item_id where a.project_id = $1`, [projectId]);
    const value = await one<any>(q, 'select coalesce(sum(round(qty*rate_paise)),0) v, coalesce(sum(round(qty*budget_rate_paise)),0) b from boq_items where project_id = $1', [projectId]);
    const committed = await one<any>(q, `select coalesce(sum(total_paise),0) c from purchase_orders where project_id = $1 and status in ('approved','issued','part_received','received','closed')`, [projectId]);
    const branches = await many<any>(q, 'select id, name from branches order by name');
    const open = await one<any>(q, `select (select count(*) from rfis where project_id=$1 and status='open') rfis, (select count(*) from ncrs where project_id=$1 and status <> 'closed') ncrs, (select count(*) from snags where project_id=$1 and status not in ('verified','closed')) snags, (select count(*) from daily_reports where project_id=$1 and status='submitted') reports`, [projectId]);
    return { p, fin, acts, value: value!, committed: committed!, branches, open: open! };
  });
  const weighted = d.acts.filter((a: any) => a.rate_paise);
  const totalW = weighted.reduce((t: number, a: any) => t + Number(a.rate_paise) * Number(a.planned_qty), 0);
  const physical = totalW > 0 ? Math.round(weighted.reduce((t: number, a: any) => t + Number(a.rate_paise) * Number(a.planned_qty) * progressBp(a.measure_rule, milli(a.done_qty), milli(a.planned_qty), a.status === 'complete') / 10000, 0) / totalW * 100) : null;
  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Physical progress" value={physical === null ? '—' : `${physical}%`} sub="From verified quantities, weighted by contract value" />
        <Stat label="Contract value" value={<Money v={d.value.v} />} sub="Billing rates" />
        {perms.has('boq:view') && <Stat label="Cost budget / committed" value={<><Money v={d.value.b} /></>} sub={<>Committed to suppliers: <Money v={d.committed.c} /></>} />}
        <Stat label="Open items" value={Number(d.open.rfis) + Number(d.open.ncrs) + Number(d.open.snags) + Number(d.open.reports)} sub={`${d.open.rfis} RFIs · ${d.open.ncrs} NCRs · ${d.open.snags} snags · ${d.open.reports} reports to review`} />
      </div>
      {d.fin && (
        <Card title="Money — four separate numbers" className="mb-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Stat label="Submitted" value={<Money v={d.fin.submitted} />} sub="Claimed in bills" /><Stat label="Certified" value={<Money v={d.fin.certified} />} sub="Cumulative gross" />
            <Stat label="Invoiced" value={<Money v={d.fin.invoiced} />} sub="Net after recoveries" /><Stat label="Collected" value={<Money v={d.fin.collected} />} sub="Cash received" /><Stat label="Disputed" value={<Money v={d.fin.disputed} />} sub="Open disputes" />
          </div>
          <p className="help mt-3">Physical and financial progress are different measures: physical comes from verified site quantities; financial from certified bills.</p>
        </Card>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Activities" actions={<Link href={`/p/${projectId}/schedule`} className="text-sm">Open schedule</Link>}>
          {d.acts.length === 0 ? <Empty title="No activities yet" action={perms.has('planning:create') && <Link className="btn btn-primary" href={`/p/${projectId}/e/activities/new`}>Add the first activity</Link>} /> :
            <ul className="divide-y divide-line">{d.acts.slice(0, 6).map((a: any) => <li key={a.id} className="py-2 flex justify-between gap-3"><span>{a.code} · {a.name}</span><span className="text-sm text-muted">{Math.round(progressBp(a.measure_rule, milli(a.done_qty), milli(a.planned_qty), a.status === 'complete') / 100)}%</span></li>)}</ul>}
        </Card>
        {perms.has('project:edit') && (
          <Card title="Project details">
            <ActionForm action={updateProjectAction.bind(null, projectId)} submit="Save details">
              <Field label="Name" name="name"><input id="name" name="name" className="input" defaultValue={d.p.name} required /></Field>
              <Field label="Location" name="location"><input id="location" name="location" className="input" defaultValue={d.p.location ?? ''} /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Start" name="start_date"><input id="start_date" name="start_date" type="date" className="input" defaultValue={d.p.start_date?.toISOString?.().slice(0, 10) ?? (d.p.start_date ? String(d.p.start_date).slice(0, 10) : '')} /></Field><Field label="Planned finish" name="end_date"><input id="end_date" name="end_date" type="date" className="input" defaultValue={d.p.end_date?.toISOString?.().slice(0, 10) ?? (d.p.end_date ? String(d.p.end_date).slice(0, 10) : '')} /></Field></div>
              <div className="grid grid-cols-2 gap-3"><Field label="Defect liability (months)" name="dlp_months"><input id="dlp_months" name="dlp_months" className="input" defaultValue={d.p.dlp_months} inputMode="numeric" /></Field>
                <Field label="Branch" name="branch_id"><select id="branch_id" name="branch_id" className="input" defaultValue={d.p.branch_id ?? ''}><option value="">None</option>{d.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field></div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
