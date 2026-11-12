import { notFound } from 'next/navigation';
import { PageHeader, Card, Table, Td, Money, Badge, Field, DL } from '@/components/ui';
import ActionForm, { ReasonForm } from '@/components/ActionForm';
import { requireSession } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { portalBill } from '@/app/actions/portal';
import { formatQty } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
export default async function PortalBill({ params }: { params: Promise<{ pid: string; id: string }> }) { const { pid, id } = await params; const s = await requireSession();
  const d = await withTenant(s.ctx, async q => { if (!/^[0-9a-f-]{36}$/.test(id)) return null; const b = await one<any>(q, 'select * from ra_bills where id=$1 and project_id=$2', [id, pid]); if (!b) return null; return { b }; });
  if (!d) notFound(); const { b } = d; const lines = await withTenant({ ...s.ctx, role: 'system' }, q => many<any>(q, 'select l.*, i.code, i.description, i.unit from ra_bill_lines l join boq_items i on i.id = l.boq_item_id where l.bill_id=$1 order by i.code', [id]));
  const cert = ['certified', 'invoiced'].includes(b.status); const decide = b.status === 'submitted';
  return (<><PageHeader title={`Running bill ${b.bill_no}`} sub={<Badge status={b.status} />} crumbs={[{ href: `/portal/${pid}`, label: 'Project' }, { label: `Bill ${b.bill_no}` }]} />
    <Card title="Quantities" className="mb-6">{decide ? <ActionForm action={portalBill.bind(null, id, true)} submit="Certify bill">
      <Table head={[{ label: 'Item' }, { label: 'Previous', num: true }, { label: 'Claimed', num: true }, { label: 'Rate', num: true, hideSm: true }, { label: 'You certify', num: true }]}>{lines.map((l: any) => <tr key={l.id}><Td>{l.code}<div className="text-xs text-muted">{l.description}</div></Td><Td num>{formatQty(milli(l.prev_cum_qty))}</Td><Td num>{formatQty(milli(l.this_qty))} {l.unit}</Td><Td num hideSm><Money v={l.rate_paise} /></Td><Td><input name={`cert_${l.id}`} aria-label={`Certified ${l.code}`} defaultValue={String(l.this_qty)} inputMode="decimal" className="input num" /></Td></tr>)}</Table>
      <Field label="Reason if you certify less than claimed" name="reduce_reason"><input id="reduce_reason" name="reduce_reason" className="input" /></Field></ActionForm> :
      <Table head={[{ label: 'Item' }, { label: 'Claimed', num: true }, { label: 'Certified', num: true }]}>{lines.map((l: any) => <tr key={l.id}><Td>{l.code}</Td><Td num>{formatQty(milli(l.this_qty))}</Td><Td num>{l.certified_this_qty === null ? '—' : formatQty(milli(l.certified_this_qty))}</Td></tr>)}</Table>}
      {decide && <div className="mt-3"><ReasonForm action={portalBill.bind(null, id, false)} label="Reject bill" reasonLabel="Why are you rejecting this bill?" danger /></div>}</Card>
    <Card title="Amounts"><DL items={[['Claimed', <Money v={b.submitted_paise} />], ['Cumulative certified gross', cert ? <Money v={b.certified_gross_paise} /> : '—'], ['Advance recovered (cum.)', cert ? <Money v={b.advance_recovery_paise} /> : '—'], ['Retention (cum.)', cert ? <Money v={b.retention_paise} /> : '—'], ['Net payable this bill', cert ? <strong><Money v={b.net_certified_paise} /></strong> : '—']]} /></Card></>); }
