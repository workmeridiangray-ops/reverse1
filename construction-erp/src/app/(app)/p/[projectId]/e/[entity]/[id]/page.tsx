import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge } from '@/components/ui';
import { EntityForm, ActionBar, EntityDetailBody } from '@/components/EntityViews';
import { Extras } from '@/components/extras';
import { entityPage, optionsFor } from '@/lib/page-helpers';
import { withTenant, many } from '@/lib/db';
import { loadRow } from '@/lib/engine';
export default async function EntityDetail({ params, searchParams }: { params: Promise<{ projectId: string; entity: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { projectId, entity, id } = await params; const sp = await searchParams;
  const { e, s, perms } = await entityPage(entity, projectId);
  const data = await withTenant(s.ctx, async q => {
    const row = await loadRow(q, e, id); if (!row || row.project_id !== projectId) return null;
    return { row, history: await many<any>(q, `select id, action, detail, at from audit_log where entity_id = $1 order by at desc limit 12`, [id]), options: await optionsFor(q, e, projectId) };
  });
  if (!data) notFound();
  const { row, history, options } = data;
  const editable = perms.has(`${e.module}:edit`) && (!e.editWhen || e.editWhen(row)) && e.fields.some(f => !f.hideForm && !f.ro);
  const back = `/p/${projectId}/e/${e.key}${sp.from ? `?${decodeURIComponent(sp.from)}` : ''}`;
  return (
    <>
      <PageHeader title={e.titleOf(row)} crumbs={[{ href: `/p/${projectId}`, label: 'Project' }, { href: back, label: e.plural }, { label: e.titleOf(row) }]}
        sub={e.status && <Badge status={String(row[e.status])} />} actions={<Link className="btn" href={back}>Back to list</Link>} />
      <div className="mb-6"><ActionBar e={e} pid={projectId} row={row} perms={perms} /></div>
      <Extras entity={e.key} row={row} projectId={projectId} perms={perms} ctx={s.ctx} />
      {editable ? <Card title="Edit"><EntityForm e={e} pid={projectId} row={row} options={options} /></Card> : null}
      <div className="mt-6"><EntityDetailBody e={e} row={row} history={history} /></div>
    </>
  );
}
