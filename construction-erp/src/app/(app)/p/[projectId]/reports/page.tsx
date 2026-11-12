import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Table, Td, Badge, Empty, fmtDate } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
export const metadata = { title: 'Site reports · Buildline' };
export default async function Reports({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('site:view')) redirect('/denied');
  const rows = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); return many<any>(q, `select r.*, w.name site, (select count(*) from report_quantities x where x.report_id=r.id) lines from daily_reports r join wbs_nodes w on w.id=r.site_id where r.project_id=$1 order by report_date desc, created_at desc limit 60`, [projectId]); });
  return (<><PageHeader title="Daily site reports" sub="Claimed quantities are reviewed by a supervisor; only verified quantities drive progress." actions={perms.has('site:create') && <Link className="btn btn-primary" href={`/p/${projectId}/reports/new`}>New report</Link>} />
    <Table head={[{ label: 'Date' }, { label: 'Site' }, { label: 'Quantity lines', num: true, hideSm: true }, { label: 'Status' }]} empty={<Empty title="No reports yet">Site staff can start a report from their phone.</Empty>}>
      {rows.map((r: any) => <tr key={r.id}><Td><Link href={`/p/${projectId}/reports/${r.id}`}>{fmtDate(r.report_date)}</Link></Td><Td>{r.site}</Td><Td num hideSm>{r.lines}</Td><Td><Badge status={r.status} /></Td></tr>)}
    </Table></>);
}
