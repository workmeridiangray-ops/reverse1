import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge } from '@/components/ui';
import { EntityForm, ActionBar, EntityDetailBody } from '@/components/EntityViews';
import { entityPage, optionsFor } from '@/lib/page-helpers';
import { withTenant, many } from '@/lib/db';
import { loadRow } from '@/lib/engine';
export default async function OrgDetail({ params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity, id } = await params; const { e, s, perms } = await entityPage(entity, null);
  const data = await withTenant(s.ctx, async q => { const row = await loadRow(q, e, id); if (!row) return null; return { row, history: await many<any>(q, `select id, action, detail, at from audit_log where entity_id = $1 order by at desc limit 12`, [id]), options: await optionsFor(q, e, null) }; });
  if (!data) notFound();
  const editable = perms.has(`${e.module}:edit`) && (!e.editWhen || e.editWhen(data.row));
  return (<><PageHeader title={e.titleOf(data.row)} crumbs={[{ href: `/o/${e.key}`, label: e.plural }, { label: e.titleOf(data.row) }]} sub={e.status && <Badge status={String(data.row[e.status])} />} actions={<Link className="btn" href={`/o/${e.key}`}>Back to list</Link>} />
    <div className="mb-6"><ActionBar e={e} pid={null} row={data.row} perms={perms} /></div>
    {editable && <Card title="Edit"><EntityForm e={e} pid={null} row={data.row} options={data.options} /></Card>}
    <div className="mt-6"><EntityDetailBody e={e} row={data.row} history={data.history} /></div></>);
}
