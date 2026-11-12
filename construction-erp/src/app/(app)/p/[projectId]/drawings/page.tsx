import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Empty, fmtDate } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
export const metadata = { title: 'Drawings & RFIs · Buildline' };
export default async function Drawings({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('drawings:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); return {
    rows: await many<any>(q, `select d.*, (select rev from drawing_revisions r where r.drawing_id = d.id and r.status='approved') cur, (select count(*) from drawing_revisions r where r.drawing_id = d.id) revs from drawings d where project_id = $1 order by number`, [projectId]),
    rfis: await many<any>(q, `select * from rfis where project_id = $1 and status in ('open','responded') order by due_date limit 10`, [projectId]) }; });
  return (<>
    <PageHeader title="Drawings & RFIs" sub="Only the approved current revision is shown as current for site execution." actions={<>{perms.has('drawings:create') && <Link className="btn btn-primary" href={`/p/${projectId}/e/drawings/new`}>New drawing</Link>}<Link className="btn" href={`/p/${projectId}/e/rfis`}>RFIs</Link><Link className="btn" href={`/p/${projectId}/e/transmittals`}>Transmittals</Link></>} />
    <Table head={[{ label: 'Drawing' }, { label: 'Title' }, { label: 'Current approved revision' }, { label: 'Revisions', num: true, hideSm: true }]} empty={<Empty title="No drawings registered">Register a drawing, then upload and approve its first revision.</Empty>}>
      {d.rows.map((r: any) => <tr key={r.id}><Td><Link href={`/p/${projectId}/e/drawings/${r.id}`}>{r.number}</Link></Td><Td>{r.title}</Td><Td>{r.cur ? <Badge status="approved" label={`Rev ${r.cur}`} /> : <Badge status="open" label="None approved" />}</Td><Td num hideSm>{r.revs}</Td></tr>)}
    </Table>
    <Card title="Open RFIs" className="mt-6"><ul className="divide-y divide-line">{d.rfis.map((r: any) => <li key={r.id} className="py-2 flex justify-between"><Link href={`/p/${projectId}/e/rfis/${r.id}`}>{r.number} · {r.location}</Link><span className="text-sm text-muted">due {fmtDate(r.due_date)} <Badge status={r.status} /></span></li>)}{d.rfis.length === 0 && <li className="py-2 text-sm text-muted">No open RFIs.</li>}</ul></Card>
  </>);
}
