import { notFound } from 'next/navigation';
import { PageHeader, Card, Table, Td, Money, Badge, Field, DL, Alert } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { portalVariation } from '@/app/actions/portal';
import { formatQty } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
export default async function PortalVariation({ params }: { params: Promise<{ pid: string; id: string }> }) { const { pid, id } = await params; const s = await requireSession();
  const d = await withTenant(s.ctx, async q => { if (!/^[0-9a-f-]{36}$/.test(id)) return null; const v = await one<any>(q, 'select * from variations where id=$1 and project_id=$2', [id, pid]); return v ? { v, items: await many<any>(q, 'select * from variation_items where variation_id=$1', [id]) } : null; });
  if (!d) notFound(); const { v } = d;
  return (<><PageHeader title={`${v.number} · ${v.title}`} sub={<Badge status={v.status} />} crumbs={[{ href: `/portal/${pid}`, label: 'Project' }, { label: v.number }]} />
    <Card title="Change" className="mb-6"><DL items={[['Scope', v.scope], ['Reason', v.reason], ['Cost impact', <Money v={v.cost_delta_paise} />], ['Time impact', `${v.time_delta_days} day(s)`], ['Decision', v.decision_reason]]} />
      <div className="mt-3"><Table head={[{ label: 'Item' }, { label: 'Qty', num: true }, { label: 'Rate', num: true }]}>{d.items.map((i: any) => <tr key={i.id}><Td>{i.description}</Td><Td num>{formatQty(milli(i.qty))} {i.unit}</Td><Td num><Money v={i.rate_paise} /></Td></tr>)}</Table></div><p className="help mt-2">Items on existing BOQ lines use the original contract rate.</p></Card>
    {v.status === 'submitted' ? <div className="grid md:grid-cols-2 gap-6"><Card title="Approve"><ActionForm action={portalVariation.bind(null, id, true)} submit="Approve variation"><Field label="Reason / reference" name="reason"><input id="reason" name="reason" className="input" required minLength={3} /></Field></ActionForm></Card><Card title="Reject"><ActionForm action={portalVariation.bind(null, id, false)} submit="Reject variation" submitClass="btn btn-danger"><Field label="Reason (required)" name="reason"><input id="reason" name="reason" className="input" required minLength={3} /></Field></ActionForm></Card></div> : <Alert kind="info">This variation has been decided.</Alert>}
    <p className="help mt-3">Your decision is limited by the approval authority and amount limit set for you on this project.</p></>); }
