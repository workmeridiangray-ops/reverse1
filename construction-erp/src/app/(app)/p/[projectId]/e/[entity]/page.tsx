import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { EntityListView } from '@/components/EntityViews';
import { entityPage } from '@/lib/page-helpers';
import { withTenant, many } from '@/lib/db';
import { listRows } from '@/lib/engine';
export default async function EntityList({ params, searchParams }: { params: Promise<{ projectId: string; entity: string }>; searchParams: Promise<Record<string, string>> }) {
  const { projectId, entity } = await params; const sp = await searchParams;
  const { e, s, perms } = await entityPage(entity, projectId);
  const data = await withTenant(s.ctx, async q => ({ ...(await listRows(q, e, projectId, { q: sp.q, status: sp.status, sort: sp.sort, dir: sp.dir, page: Number(sp.page) || 1 })), views: await many<any>(q, 'select * from saved_views where scope = $1 order by name', [`${projectId}:${e.key}`]) }));
  const canCreate = perms.has(`${e.module}:create`);
  return (
    <>
      <PageHeader title={e.plural} sub={e.blurb} crumbs={[{ href: `/p/${projectId}`, label: 'Project' }, { label: e.plural }]} actions={canCreate && <Link className="btn btn-primary" href={`/p/${projectId}/e/${e.key}/new`}>New {e.singular.toLowerCase()}</Link>} />
      <EntityListView e={e} pid={projectId} {...data} sp={sp} base={`/p/${projectId}/e/${e.key}`} perms={perms} canCreate={canCreate} />
    </>
  );
}
