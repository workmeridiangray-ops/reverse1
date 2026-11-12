import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Stat } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, one } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
export const metadata = { title: 'Quality & safety · Buildline' };
export default async function Quality({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('quality:view')) redirect('/denied');
  const c = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); return (await one<any>(q, `select (select count(*) from inspections where project_id=$1 and status='requested') pend, (select count(*) from inspections where project_id=$1 and hold_point and status='requested') holds, (select count(*) from ncrs where project_id=$1 and status<>'closed') ncr, (select count(*) from safety_observations where project_id=$1 and status='open') obs`, [projectId]))!; });
  return (<>
    <PageHeader title="Quality & safety" sub="Inspections tied to location, activity and drawing revision. Hold points block downstream work until passed. A completed checklist is a record, not a certificate." actions={perms.has('quality:create') && <Link className="btn btn-primary" href={`/p/${projectId}/e/inspections/new`}>Request inspection</Link>} />
    <div className="grid sm:grid-cols-4 gap-4 mb-6"><Stat label="Inspections pending" value={c.pend} /><Stat label="Hold points pending" value={c.holds} /><Stat label="Open NCRs" value={c.ncr} /><Stat label="Open safety observations" value={c.obs} /></div>
    <Card><ul className="space-y-2"><li><Link href={`/p/${projectId}/e/inspections`}>Inspections & hold points</Link></li><li><Link href={`/p/${projectId}/e/ncrs`}>Nonconformances & corrective actions</Link></li>{perms.has('safety:view') && <li><Link href={`/p/${projectId}/e/observations`}>Safety observations</Link></li>}<li><Link href={`/p/${projectId}/e/incidents`}>Safety incidents (restricted access)</Link></li></ul></Card>
  </>);
}
