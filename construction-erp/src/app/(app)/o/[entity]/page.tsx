import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { EntityListView } from '@/components/EntityViews';
import { entityPage } from '@/lib/page-helpers';
import { withTenant, many } from '@/lib/db';
import { listRows } from '@/lib/engine';
export default async function OrgList({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: Promise<Record<string, string>> }) {
  const { entity } = await params; const sp = await searchParams;
  const { e, s, perms } = await entityPage(entity, null);
  const data = await withTenant(s.ctx, async q => ({ ...(await listRows(q, e, null, { q: sp.q, status: sp.status, sort: sp.sort, dir: sp.dir, page: Number(sp.page) || 1 })), views: await many<any>(q, 'select * from saved_views where scope = $1 order by name', [`org:${e.key}`]) }));
  const canCreate = perms.has(`${e.module}:create`);
  return (<><PageHeader title={e.plural} sub={e.blurb} actions={canCreate && <Link className="btn btn-primary" href={`/o/${e.key}/new`}>New {e.singular.toLowerCase()}</Link>} />
    <EntityListView e={e} pid={null} {...data} sp={sp} base={`/o/${e.key}`} perms={perms} canCreate={canCreate} /></>);
}
