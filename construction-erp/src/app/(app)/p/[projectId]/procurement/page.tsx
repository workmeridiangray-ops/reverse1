import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Money, Field, Empty } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { comparison } from '@/lib/domain/procurement';
import { addQuoteAction, awardQuoteAction } from '@/app/actions/extras';
import { formatQty } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
export const metadata = { title: 'Procurement · Buildline' };
export default async function Procurement({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('procurement:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId);
    const rfqs = await many<any>(q, `select r.*, m.number mr from rfqs r join material_requests m on m.id = r.mr_id where r.project_id = $1 order by r.created_at desc`, [projectId]);
    const full = [];
    for (const r of rfqs) full.push({ ...r, lines: await many<any>(q, 'select * from mr_lines where mr_id = $1', [r.mr_id]), quotes: await comparison(q, r.id) });
    return { rfqs: full, suppliers: await many<any>(q, `select id, name from parties where kind='supplier' and active order by name`),
      pos: await many<any>(q, `select p.*, s.name supplier from purchase_orders p join parties s on s.id = p.supplier_id where p.project_id = $1 order by p.created_at desc limit 15`, [projectId]),
      mrs: await many<any>(q, `select * from material_requests where project_id = $1 order by created_at desc limit 10`, [projectId]) }; });
  return (<>
    <PageHeader title="Procurement" sub="Request → approval → RFQ → comparison → purchase order → goods receipt." actions={perms.has('procurement:create') && <Link className="btn btn-primary" href={`/p/${projectId}/e/material_requests/new`}>New material request</Link>} />
    <div className="grid lg:grid-cols-2 gap-6 mb-6">
      <Card title="Material requests" actions={<Link className="text-sm" href={`/p/${projectId}/e/material_requests`}>All</Link>}><Table head={[{ label: 'No.' }, { label: 'Needed by', hideSm: true }, { label: 'Status' }]} empty={<Empty title="No requests yet" />}>{d.mrs.map((m: any) => <tr key={m.id}><Td><Link href={`/p/${projectId}/e/material_requests/${m.id}`}>{m.number}</Link></Td><Td hideSm>{m.needed_by ? String(m.needed_by).slice(0, 10) : '—'}</Td><Td><Badge status={m.status} /></Td></tr>)}</Table></Card>
      <Card title="Purchase orders" actions={<Link className="text-sm" href={`/p/${projectId}/e/purchase_orders`}>All</Link>}><Table head={[{ label: 'PO' }, { label: 'Supplier', hideSm: true }, { label: 'Total', num: true }, { label: 'Status' }]} empty={<Empty title="No orders yet" />}>{d.pos.map((p: any) => <tr key={p.id}><Td><Link href={`/p/${projectId}/e/purchase_orders/${p.id}`}>{p.number}</Link></Td><Td hideSm>{p.supplier}</Td><Td num><Money v={p.total_paise} /></Td><Td><Badge status={p.status} /></Td></tr>)}</Table></Card>
    </div>
    {d.rfqs.map((r: any) => (
      <Card key={r.id} title={`RFQ ${r.number} (for ${r.mr}) `} className="mb-6" actions={<Badge status={r.status} />}>
        {r.quotes.length > 0 && <Table head={[{ label: 'Supplier' }, { label: 'Total', num: true }, { label: 'Lead time', hideSm: true }, { label: '' }]}>{r.quotes.map((qt: any, i: number) => <tr key={qt.id}><Td>{qt.supplier}{i === 0 && <span className="badge ml-2 bg-ok-soft text-ok border-[#b9dcc5]">lowest</span>}</Td><Td num><Money v={qt.total_paise} /></Td><Td hideSm>{qt.lead_days ?? '—'} days</Td>
          <Td>{r.status === 'open' && perms.has('procurement:create') && <ActionForm action={awardQuoteAction.bind(null, qt.id)} submit="Create PO from this quote" submitClass="btn btn-sm btn-primary"><input type="date" name="delivery_date" aria-label="Delivery date" className="input" /></ActionForm>}</Td></tr>)}</Table>}
        {r.status === 'open' && perms.has('procurement:create') && (
          <div className="mt-4"><h3 className="mb-2">Add a supplier quote</h3><ActionForm action={addQuoteAction.bind(null, r.id)} submit="Record quote" resetOnSuccess>
            <div className="grid sm:grid-cols-2 gap-3"><Field label="Supplier" name="supplier_id" required><select id="supplier_id" name="supplier_id" className="input" required><option value="">Choose…</option>{d.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Lead time (days)" name="lead_days"><input id="lead_days" name="lead_days" className="input" inputMode="numeric" /></Field></div>
            {r.lines.map((l: any) => <Field key={l.id} label={`Rate for ${l.item_code} — ${formatQty(milli(l.qty))} ${l.unit} (₹ per ${l.unit})`} name={`rate_${l.id}`} required><input id={`rate_${l.id}`} name={`rate_${l.id}`} className="input" inputMode="decimal" required /></Field>)}
          </ActionForm></div>)}
      </Card>))}
    {d.suppliers.length === 0 && <p className="text-sm text-muted">Add suppliers under <Link href="/o/parties">Companies & contacts</Link> to request quotes.</p>}
  </>);
}
