import { notFound, redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Money, Field, Alert, Stat } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { estimateSummary } from '@/lib/domain/estimating';
import * as T from '@/app/actions/tender';
import { formatQty } from '@/lib/rules/money';
import { marginBp as mb } from '@/lib/rules/boq';
import { milli } from '@/lib/domain/common';
export default async function Tender({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rev?: string }> }) {
  const { id } = await params; const sp = await searchParams; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('tender:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { if (!/^[0-9a-f-]{36}$/.test(id)) return null; const o = await one<any>(q, 'select * from opportunities where id=$1', [id]); if (!o) return null;
    const revs = await many<any>(q, 'select * from estimate_revisions where opportunity_id=$1 order by rev_no desc', [id]); const cur = revs.find(r => r.id === sp.rev) ?? revs[0];
    return { o, revs, cur, sum: cur ? await estimateSummary(q, cur.id) : null }; });
  if (!d) notFound(); const { o, cur, sum } = d; const draft = cur?.status === 'draft';
  return (<><PageHeader title={o.name} sub={<Badge status={o.status} />} crumbs={[{ href: '/tenders', label: 'Tenders' }, { label: o.name }]} />
    <Card title="Estimate revisions" className="mb-6"><div className="flex flex-wrap gap-2 mb-3">{d.revs.map((r: any) => <a key={r.id} className={`btn btn-sm ${cur?.id === r.id ? 'btn-primary' : ''}`} href={`/tenders/${id}?rev=${r.id}`}>Rev {r.rev_no} · {r.status}</a>)}</div>
      {perms.has('tender:create') && o.status !== 'awarded' && <ActionForm action={T.newRevisionAction.bind(null, id)} submit={d.revs.length ? 'New revision (copy of latest)' : 'Create first revision'} submitClass="btn btn-sm"><input type="hidden" name="copy" value={d.revs[0]?.id ?? ''} /></ActionForm>}</Card>
    {cur && sum && (<>
      <div className="grid sm:grid-cols-3 gap-4 mb-6"><Stat label="Tender price" value={<Money v={sum.tender} />} sub="What you will bill" /><Stat label="Direct cost (from build-ups)" value={<Money v={sum.direct} />} sub="Becomes the cost budget on award" /><Stat label="Indicative margin" value={sum.direct > 0n ? `${(mb(sum.tender, sum.direct) / 100).toFixed(1)}%` : '—'} sub="Internal only; never shown to clients" /></div>
      {draft && perms.has('tender:edit') && <Card title="Import BOQ (CSV)" className="mb-6"><ActionForm action={T.importCsvAction.bind(null, cur.id)} submit="Import" secondary={<button type="submit" name="intent" value="preview" className="btn">Preview & check rows</button>}>
        <p className="text-sm text-muted">Columns: <code>code,description,unit,qty,rate</code> (rate in rupees). Every row is validated; nothing is saved unless all rows pass.</p>
        <Field label="CSV file" name="file"><input id="file" name="file" type="file" accept=".csv,text/csv" className="input py-2" /></Field><Field label="…or paste CSV" name="text"><textarea id="text" name="text" rows={4} className="input font-mono" /></Field></ActionForm></Card>}
      <Card title={`BOQ — revision ${cur.rev_no}`} className="mb-6"><Table head={[{ label: 'Code' }, { label: 'Description' }, { label: 'Qty', num: true }, { label: 'Rate', num: true }, { label: 'Direct cost/unit', num: true, hideSm: true }, { label: 'Source', hideSm: true }]} empty={<p className="p-4 text-sm text-muted">No items yet — import a CSV above.</p>}>
        {sum.items.map((i: any) => <tr key={i.id}><Td>{i.code}</Td><Td>{i.description}</Td><Td num>{formatQty(milli(i.qty))} {i.unit}</Td><Td num><Money v={i.rate_paise} /></Td><Td num hideSm><Money v={BigInt(i.mat_paise) + BigInt(i.lab_paise) + BigInt(i.eqp_paise)} /></Td><Td hideSm>qty: {i.qty_source}, rate: {i.rate_source}
          {draft && perms.has('tender:edit') && <details><summary className="cursor-pointer text-accent">Rate analysis</summary><ActionForm action={T.buildUpAction.bind(null, i.id)} submit="Apply"><div className="grid grid-cols-3 gap-2"><Field label="Material ₹" name="mat"><input id="mat" name="mat" className="input" defaultValue="0" /></Field><Field label="Labour ₹" name="lab"><input id="lab" name="lab" className="input" defaultValue="0" /></Field><Field label="Equipment ₹" name="eqp"><input id="eqp" name="eqp" className="input" defaultValue="0" /></Field></div></ActionForm></details>}</Td></tr>)}</Table></Card>
      {draft && perms.has('tender:approve') && sum.items.length > 0 && <Card className="mb-6"><ActionForm action={T.approveRevisionAction.bind(null, cur.id)} submit="Approve this revision (bid review)"><p className="text-sm text-muted">Approving freezes the quantities, units and rates and supersedes any earlier approved revision.</p></ActionForm></Card>}
      {cur.status === 'approved' && o.status !== 'awarded' && perms.has('tender:approve') && <Card title="Award → create project"><ActionForm action={T.awardAction.bind(null, id, cur.id)} submit="Award & create project"><div className="grid sm:grid-cols-3 gap-3"><Field label="Project code" name="code" required><input id="code" name="code" className="input" required /></Field><Field label="Project name" name="name" required><input id="name" name="name" className="input" defaultValue={o.name} required /></Field><Field label="Contingency (bp of budget)" name="contingency_bp" help="500 = 5%"><input id="contingency_bp" name="contingency_bp" className="input" defaultValue="500" /></Field></div></ActionForm></Card>}
    </>)}</>);
}
