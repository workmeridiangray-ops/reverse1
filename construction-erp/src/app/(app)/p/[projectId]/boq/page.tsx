import Link from 'next/link';
import { PageHeader, Card, Table, Td, Money, Badge, Alert, Stat } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { redirect } from 'next/navigation';
import { formatQty, lineAmount } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
import { budgetReconciliation } from '@/lib/domain/procurement';
export const metadata = { title: 'BOQ & budget · Buildline' };
export default async function Boq({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('boq:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => ({ p: await projectOrNotFound(q, projectId), rec: await budgetReconciliation(q, projectId), base: await many<any>(q, 'select * from budget_baselines where project_id = $1 order by baseline_no desc', [projectId]) }));
  const tender = d.rec.reduce((t: bigint, r: any) => t + lineAmount(milli(r.qty), BigInt(r.rate_paise ?? 0)), 0n);
  const sumBudget = d.rec.reduce((t: bigint, r: any) => t + r.pos.budget, 0n), sumCommitted = d.rec.reduce((t: bigint, r: any) => t + r.pos.committed, 0n);
  const bl = d.base[0];
  return (
    <>
      <PageHeader title="BOQ & budget" sub="Tender price (what you bill), approved cost budget (what you plan to spend) and committed purchasing are kept apart." />
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <Stat label="Baseline cost budget" value={<Money v={bl?.budget_total_paise ?? sumBudget} />} sub={bl ? `Baseline ${bl.baseline_no}` : 'Current'} />
        <Stat label="Contingency" value={<Money v={bl?.contingency_paise ?? 0} />} sub="Held separately from the budget lines" />
        <Stat label="Committed (approved POs)" value={<Money v={sumCommitted} />} sub={<>Uncommitted budget: <Money v={sumBudget - sumCommitted} /></>} />
      </div>
      <Table head={[{ label: 'Item' }, { label: 'Description', hideSm: true }, { label: 'Qty', num: true }, { label: 'Contract rate', num: true, hideSm: true }, { label: 'Budget', num: true }, { label: 'Committed', num: true }, { label: 'Received', num: true, hideSm: true }]}>
        {d.rec.map((r: any) => (
          <tr key={r.id}><Td>{r.code}</Td><Td hideSm>{r.description}</Td><Td num>{formatQty(milli(r.qty))}</Td><Td num hideSm><Money v={r.rate_paise ?? 0} /></Td><Td num><Money v={r.pos.budget} /></Td>
            <Td num className={r.pos.overCommitted ? 'text-bad font-semibold' : ''}><Money v={r.pos.committed} />{r.pos.overCommitted && <div className="text-xs">over budget</div>}</Td><Td num hideSm><Money v={r.pos.receivedValue} /></Td></tr>
        ))}
      </Table>
      <p className="help mt-2">Received = accepted quantities only; rejected material is excluded. BOQ quantity changes only through approved variations once the contract is active.</p>
    </>
  );
}
