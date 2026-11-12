import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Money, Empty } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { workOrderPosition } from '@/lib/domain/subcontract';
import { formatQty } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
export const metadata = { title: 'Subcontract · Buildline' };
export default async function Subcontract({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('subcontract:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); const wos = await many<any>(q, `select w.*, p.name sub from work_orders w join parties p on p.id = w.subcontractor_id where w.project_id=$1 order by w.created_at desc`, [projectId]);
    const out = []; for (const w of wos) out.push({ ...w, pos: await workOrderPosition(q, w.id) }); return out; });
  const L = (k: string, l: string) => <Link className="btn" href={`/p/${projectId}/e/${k}`}>{l}</Link>;
  return (<>
    <PageHeader title="Subcontracting" sub="Packages → bids → work orders → measurement → verified bills. Measured work is billed once." actions={<>{perms.has('subcontract:create') && <Link className="btn btn-primary" href={`/p/${projectId}/e/work_orders/new`}>New work order</Link>}{L('packages', 'Packages')}{L('bids', 'Bids')}{L('measurement_sheets', 'Measurement sheets')}{L('sub_bills', 'Subcontract bills')}</>} />
    {d.length === 0 ? <Card><Empty title="No work orders yet">Create a package, record bids, then raise a work order against BOQ scope.</Empty></Card> : d.map((w: any) => (
      <Card key={w.id} className="mb-6" title={<Link href={`/p/${projectId}/e/work_orders/${w.id}`}>{w.number} · {w.sub}</Link>} actions={<Badge status={w.status} />}>
        <Table head={[{ label: 'Item' }, { label: 'Limit', num: true }, { label: 'Measured (cumulative)', num: true }, { label: 'Billed', num: true }, { label: 'Rate', num: true, hideSm: true }]}>{w.pos.map((i: any) => <tr key={i.id}><Td>{i.description}</Td><Td num>{formatQty(milli(i.qty_limit))} {i.unit}</Td><Td num>{formatQty(milli(i.measured))}</Td><Td num>{formatQty(milli(i.billed))}</Td><Td num hideSm><Money v={i.rate_paise} /></Td></tr>)}</Table>
      </Card>))}
  </>);
}
