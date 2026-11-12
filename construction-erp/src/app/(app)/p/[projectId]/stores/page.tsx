import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Field, Empty, Alert } from '@/components/ui';
import ActionForm, { ConfirmButton } from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { stockBalances } from '@/lib/domain/procurement';
import * as A from '@/app/actions/project';
import { formatQty } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
export const metadata = { title: 'Stores · Buildline' };
export default async function Stores({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('stores:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); return { bal: await stockBalances(q, projectId), sites: await many<any>(q, `select id, code, name from wbs_nodes where project_id=$1 and kind='site' order by code`, [projectId]),
    acts: await many<any>(q, 'select id, code, name from activities where project_id=$1 order by code', [projectId]), tr: await many<any>(q, `select t.*, f.name fname, d.name dname from site_transfers t join wbs_nodes f on f.id=t.from_site_id join wbs_nodes d on d.id=t.to_site_id where t.project_id=$1 order by t.created_at desc limit 10`, [projectId]) }; });
  const canWrite = perms.has('stores:create'); const items = [...new Set(d.bal.map((b: any) => b.item_code))];
  const SiteSel = ({ name, label }: { name: string; label: string }) => <Field label={label} name={name} required><select id={name} name={name} className="input" required><option value="">Choose…</option>{d.sites.map((x: any) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field>;
  const ItemInp = () => <Field label="Item code" name="item_code" required><input id="item_code" name="item_code" list="items" className="input" required /><datalist id="items">{items.map(i => <option key={i} value={i} />)}</datalist></Field>;
  const Qty = () => <Field label="Quantity" name="qty" required><input id="qty" name="qty" inputMode="decimal" className="input" required /></Field>;
  return (<>
    <PageHeader title="Stores" sub="Stock by site. Goods are received against purchase orders; rejected material waits in quarantine." />
    {d.sites.length === 0 && <div className="mb-4"><Alert kind="warn">Create at least one site under <Link href={`/p/${projectId}/e/wbs/new`}>Sites & zones</Link> to hold stock.</Alert></div>}
    <Table head={[{ label: 'Site' }, { label: 'Item' }, { label: 'Description', hideSm: true }, { label: 'Where' }, { label: 'On hand', num: true }]} empty={<Empty title="No stock yet">Receive goods against an issued purchase order.</Empty>}>
      {d.bal.map((b: any, i: number) => <tr key={i}><Td>{b.site}</Td><Td>{b.item_code}</Td><Td hideSm>{b.description}</Td><Td>{b.bucket === 'quarantine' ? <Badge status="blocked" label="Quarantine (rejected)" /> : 'Store'}</Td><Td num>{formatQty(milli(b.qty))} {b.unit}</Td></tr>)}
    </Table>
    {canWrite && (<div className="grid lg:grid-cols-2 gap-6 mt-6">
      <Card title="Issue to activity"><ActionForm action={A.issueStockAction.bind(null, projectId)} submit="Issue material" resetOnSuccess><SiteSel name="site_id" label="From site store" /><ItemInp /><Qty /><Field label="Used on activity" name="activity_id"><select id="activity_id" name="activity_id" className="input"><option value="">None</option>{d.acts.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field></ActionForm></Card>
      <Card title="Transfer between sites"><ActionForm action={A.dispatchTransferAction.bind(null, projectId)} submit="Dispatch" resetOnSuccess><SiteSel name="from_site_id" label="From" /><SiteSel name="to_site_id" label="To" /><ItemInp /><Qty /></ActionForm></Card>
      <Card title="Return unused material to store"><ActionForm action={A.returnStoreAction.bind(null, projectId)} submit="Return" resetOnSuccess><SiteSel name="site_id" label="Site" /><ItemInp /><Qty /></ActionForm></Card>
      <Card title="Send rejected material back to supplier"><ActionForm action={A.returnSupplierAction.bind(null, projectId)} submit="Record supplier return" resetOnSuccess><SiteSel name="site_id" label="Site" /><ItemInp /><Qty /><Field label="Debit note / replacement reference" name="note" required><input id="note" name="note" className="input" required minLength={3} /></Field></ActionForm></Card>
      <Card title="Stock count" className="lg:col-span-2"><ActionForm action={A.stockCountAction.bind(null, projectId)} submit="Apply count"><SiteSel name="site_id" label="Site counted" /><p className="help">Enter what you physically counted. Differences from the system are posted as adjustments.</p><div className="grid sm:grid-cols-3 gap-3">{d.bal.filter((b: any) => b.bucket === 'store').map((b: any, i: number) => <div key={i}><Field label={`${b.site} · ${b.item_code} (system ${formatQty(milli(b.qty))})`} name={`count_${b.item_code}`}><input id={`count_${b.item_code}`} name={`count_${b.item_code}`} inputMode="decimal" className="input" /></Field><input type="hidden" name={`unit_${b.item_code}`} value={b.unit} /></div>)}</div></ActionForm></Card>
    </div>)}
    <Card title="Site transfers" className="mt-6"><Table head={[{ label: 'No.' }, { label: 'From → To' }, { label: 'Status' }, { label: '' }]} empty={<Empty title="No transfers" />}>{d.tr.map((t: any) => <tr key={t.id}><Td>{t.number}</Td><Td>{t.fname} → {t.dname}</Td><Td><Badge status={t.status} /></Td><Td>{t.status === 'in_transit' && canWrite && <ConfirmButton action={A.receiveTransferAction.bind(null, t.id)} label="Confirm received" confirmText="Confirm the material has arrived at the destination?" className="btn btn-sm btn-primary" />}</Td></tr>)}</Table></Card>
  </>);
}
