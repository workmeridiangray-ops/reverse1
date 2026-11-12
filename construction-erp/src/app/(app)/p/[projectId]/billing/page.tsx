import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Money, Stat, Field, Empty, fmtDate } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { financialPosition } from '@/lib/domain/billing';
import { createBillAction } from '@/app/actions/project';
export const metadata = { title: 'Client billing · Buildline' };
export default async function Billing({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('billing:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); return { fin: await financialPosition(q, projectId), c: await one<any>(q, `select * from contracts where project_id=$1 and status='active'`, [projectId]),
    bills: await many<any>(q, 'select * from ra_bills where project_id=$1 order by bill_no desc', [projectId]), inv: await many<any>(q, 'select * from invoices where project_id=$1 order by created_at desc', [projectId]),
    mb: await one<any>(q, `select count(*) filter (where status='verified') ready, count(*) filter (where status='draft') draft from measurement_book where project_id=$1`, [projectId]) }; });
  return (<>
    <PageHeader title="Client billing" sub="Measurement book → running bill → certification → invoice → collection. Each stage is a different number." actions={<Link className="btn" href={`/p/${projectId}/e/measurement_book`}>Measurement book</Link>} />
    <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6"><Stat label="Submitted" value={<Money v={d.fin.submitted} />} /><Stat label="Certified (cum. gross)" value={<Money v={d.fin.certified} />} /><Stat label="Invoiced" value={<Money v={d.fin.invoiced} />} /><Stat label="Collected" value={<Money v={d.fin.collected} />} /><Stat label="Disputed" value={<Money v={d.fin.disputed} />} /></div>
    {d.c && perms.has('billing:create') && <Card title="Start the next running bill" className="mb-6"><p className="text-sm text-muted mb-3">{d.mb.ready} verified measurement(s) are ready to bill; {d.mb.draft} still need verification.</p>
      <ActionForm action={createBillAction.bind(null, d.c.id, projectId)} submit="Create bill from verified measurements"><Field label="Bill period up to" name="period_to" required><input id="period_to" name="period_to" type="date" className="input" required /></Field></ActionForm></Card>}
    {!d.c && <p className="mb-4 text-sm">An active contract is needed to bill. <Link href={`/p/${projectId}/contract`}>Set up the contract</Link>.</p>}
    <Card title="Running bills" className="mb-6"><Table head={[{ label: 'Bill' }, { label: 'Period', hideSm: true }, { label: 'Submitted', num: true }, { label: 'Net payable', num: true }, { label: 'Status' }]} empty={<Empty title="No bills yet" />}>{d.bills.map((b: any) => <tr key={b.id}><Td><Link href={`/p/${projectId}/billing/${b.id}`}>Bill {b.bill_no}</Link></Td><Td hideSm>{fmtDate(b.period_to)}</Td><Td num><Money v={b.submitted_paise} /></Td><Td num>{b.status === 'certified' || b.status === 'invoiced' ? <Money v={b.net_certified_paise} /> : '—'}</Td><Td><Badge status={b.status} /></Td></tr>)}</Table></Card>
    <Card title="Invoices & collections"><Table head={[{ label: 'Invoice' }, { label: 'Due', hideSm: true }, { label: 'Amount', num: true }, { label: 'Collected', num: true }, { label: 'Status' }]} empty={<Empty title="No invoices yet" />}>{d.inv.map((i: any) => <tr key={i.id}><Td>{i.number}</Td><Td hideSm>{fmtDate(i.due_date)}</Td><Td num><Money v={i.amount_paise} /></Td><Td num><Money v={i.collected_paise} /></Td><Td><Badge status={i.status} /></Td></tr>)}</Table></Card>
  </>);
}
