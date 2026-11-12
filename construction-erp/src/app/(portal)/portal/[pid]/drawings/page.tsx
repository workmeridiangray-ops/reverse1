import { PageHeader, Table, Td, Badge, Empty, fmtDate } from '@/components/ui';
import { requireSession } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
export default async function PortalDrawings({ params }: { params: Promise<{ pid: string }> }) { const { pid } = await params; const s = await requireSession();
  const rows = await withTenant(s.ctx, q => many<any>(q, `select d.number, d.title, r.rev, r.file_id, r.approved_at from drawing_revisions r join drawings d on d.id = r.drawing_id where r.project_id = $1 order by d.number`, [pid]));
  return (<><PageHeader title="Approved drawings" sub="Only approved, current revisions are listed." crumbs={[{ href: `/portal/${pid}`, label: 'Project' }, { label: 'Drawings' }]} /><Table head={[{ label: 'Drawing' }, { label: 'Title' }, { label: 'Revision' }, { label: 'Approved' }, { label: 'File' }]} empty={<Empty title="No approved drawings yet" />}>{rows.map((r: any) => <tr key={r.number}><Td>{r.number}</Td><Td>{r.title}</Td><Td><Badge status="approved" label={`Rev ${r.rev}`} /></Td><Td>{fmtDate(r.approved_at)}</Td><Td>{r.file_id ? <a href={`/api/files/${r.file_id}`}>Download</a> : '—'}</Td></tr>)}</Table></>); }
