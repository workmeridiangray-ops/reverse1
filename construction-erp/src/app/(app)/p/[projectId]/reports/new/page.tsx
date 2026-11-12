import { redirect } from 'next/navigation';
import { PageHeader, Card, Alert } from '@/components/ui';
import ReportEditor from '@/components/ReportEditor';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
export default async function NewReport({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('site:create')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); return { sites: await many<any>(q, `select id, code || ' · ' || name label from wbs_nodes where project_id=$1 and kind='site' order by code`, [projectId]), acts: await many<any>(q, `select id, code || ' · ' || name label from activities where project_id=$1 and status <> 'complete' order by code`, [projectId]) }; });
  return (<><PageHeader title="New daily report" crumbs={[{ href: `/p/${projectId}/reports`, label: 'Site reports' }, { label: 'New' }]} />
    {d.sites.length === 0 ? <Alert kind="warn">No site exists yet. Ask a manager to add a site under Sites & zones.</Alert> : <Card><ReportEditor projectId={projectId} sites={d.sites} activities={d.acts} /></Card>}</>);
}
