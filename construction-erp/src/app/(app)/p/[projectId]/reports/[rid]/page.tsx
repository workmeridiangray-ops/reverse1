import { notFound, redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Alert, Field, fmtDate } from '@/components/ui';
import ActionForm, { ReasonForm } from '@/components/ActionForm';
import ReportEditor from '@/components/ReportEditor';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { reportDetail } from '@/lib/domain/site';
import { verifyReportAction, requestCorrectionAction } from '@/app/actions/project';
import { formatQty } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
export default async function ReportPage({ params }: { params: Promise<{ projectId: string; rid: string }> }) {
  const { projectId, rid } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('site:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { if (!/^[0-9a-f-]{36}$/.test(rid)) return null; const r = await reportDetail(q, rid); if (!r || r.project_id !== projectId) return null;
    return { r, sites: await many<any>(q, `select id, code || ' · ' || name label from wbs_nodes where project_id=$1 and kind='site'`, [projectId]), acts: await many<any>(q, `select id, code || ' · ' || name label from activities where project_id=$1 order by code`, [projectId]) }; });
  if (!d) notFound();
  const { r } = d; const editable = ['draft', 'correction_requested'].includes(r.status) && perms.has('site:create');
  const initial = { site_id: r.site_id, report_date: String(r.report_date).slice(0, 10), weather: r.weather, notes: r.notes,
    lab: r.labour.length ? r.labour.map((x: any) => ({ trade: x.trade, headcount: String(x.headcount), hours: String(x.hours) })) : [{ trade: '', headcount: '', hours: '8' }],
    eq: r.equipment.length ? r.equipment.map((x: any) => ({ name: x.name, hours: String(x.hours), idle: String(x.idle_hours) })) : [{ name: '', hours: '', idle: '0' }],
    qt: r.quantities.length ? r.quantities.map((x: any) => ({ activity: x.activity_id, claimed: String(x.claimed_qty) })) : [{ activity: '', claimed: '' }],
    is: r.issues.length ? r.issues.map((x: any) => ({ text: x.text, severity: x.severity })) : [{ text: '', severity: 'low' }] };
  return (<>
    <PageHeader title={`${r.site_name} · ${fmtDate(r.report_date)}`} sub={<Badge status={r.status} />} crumbs={[{ href: `/p/${projectId}/reports`, label: 'Site reports' }, { label: fmtDate(r.report_date) }]} />
    {r.status === 'correction_requested' && <div className="mb-4"><Alert kind="warn" title="Correction requested">{r.correction_reason}</Alert></div>}
    {editable ? <Card title="Edit report"><ReportEditor projectId={projectId} sites={d.sites} activities={d.acts} initial={initial} reportId={r.id} version={r.version} /></Card> : (<>
      <Card title="Work quantities — claimed vs verified" className="mb-6">
        {r.status === 'submitted' && perms.has('site:approve') ? (
          <ActionForm action={verifyReportAction.bind(null, r.id)} submit="Verify report">
            <Table head={[{ label: 'Activity' }, { label: 'Claimed', num: true }, { label: 'Verified', num: true }, { label: 'Reason if different' }]}>{r.quantities.map((x: any) => <tr key={x.id}><Td>{x.code} · {x.name}</Td><Td num>{formatQty(milli(x.claimed_qty))}</Td><Td><input name={`vq_${x.id}`} aria-label={`Verified quantity for ${x.code}`} inputMode="decimal" defaultValue={String(x.claimed_qty)} className="input num" required /></Td><Td><input name={`vr_${x.id}`} aria-label={`Reason for ${x.code}`} className="input" /></Td></tr>)}</Table>
            <p className="help">A different verified quantity needs an explanation. Activities behind an unpassed hold point cannot be verified.</p>
          </ActionForm>
        ) : <Table head={[{ label: 'Activity' }, { label: 'Claimed', num: true }, { label: 'Verified', num: true }, { label: 'Explanation' }]}>{r.quantities.map((x: any) => <tr key={x.id}><Td>{x.code} · {x.name}</Td><Td num>{formatQty(milli(x.claimed_qty))}</Td><Td num>{x.verified_qty === null ? '—' : formatQty(milli(x.verified_qty))}</Td><Td>{x.correction_reason ?? ''}</Td></tr>)}</Table>}
        {r.status === 'submitted' && perms.has('site:approve') && <div className="mt-3"><ReasonForm action={requestCorrectionAction.bind(null, r.id)} label="Send back for correction" reasonLabel="What must be corrected?" danger /></div>}
      </Card>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Labour"><Table head={[{ label: 'Trade' }, { label: 'People', num: true }, { label: 'Hours', num: true }]}>{r.labour.map((l: any) => <tr key={l.id}><Td>{l.trade}</Td><Td num>{l.headcount}</Td><Td num>{l.hours}</Td></tr>)}</Table></Card>
        <Card title="Equipment"><Table head={[{ label: 'Equipment' }, { label: 'Hours', num: true }, { label: 'Idle', num: true }]}>{r.equipment.map((l: any) => <tr key={l.id}><Td>{l.name}</Td><Td num>{l.hours}</Td><Td num>{l.idle_hours}</Td></tr>)}</Table></Card>
        <Card title="Issues">{r.issues.length ? <ul className="space-y-1">{r.issues.map((i: any) => <li key={i.id}>{i.text} <Badge status={i.severity === 'high' ? 'critical' : i.severity === 'medium' ? 'open' : 'neutral'} label={i.severity} /></li>)}</ul> : <p className="text-sm text-muted">None reported.</p>}</Card>
        <Card title="Photos">{r.photos.length ? <ul className="space-y-1">{r.photos.map((p: any) => <li key={p.id}><a href={`/api/files/${p.file_id}`}>{p.name}</a></li>)}</ul> : <p className="text-sm text-muted">No photos.</p>}</Card>
      </div>
      {r.notes && <Card title="Notes" className="mt-6"><p>{r.notes}</p></Card>}
    </>)}
  </>);
}
