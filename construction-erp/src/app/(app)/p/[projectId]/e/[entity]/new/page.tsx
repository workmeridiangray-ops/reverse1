import { redirect } from 'next/navigation';
import { PageHeader, Card, Alert } from '@/components/ui';
import { EntityForm } from '@/components/EntityViews';
import { entityPage, optionsFor } from '@/lib/page-helpers';
import { withTenant } from '@/lib/db';
export default async function NewEntity({ params }: { params: Promise<{ projectId: string; entity: string }> }) {
  const { projectId, entity } = await params;
  const { e, s, perms } = await entityPage(entity, projectId);
  if (!perms.has(`${e.module}:create`)) redirect('/denied');
  const options = await withTenant(s.ctx, q => optionsFor(q, e, projectId));
  return (
    <>
      <PageHeader title={`New ${e.singular.toLowerCase()}`} crumbs={[{ href: `/p/${projectId}`, label: 'Project' }, { href: `/p/${projectId}/e/${e.key}`, label: e.plural }, { label: 'New' }]} />
      <Card><EntityForm e={e} pid={projectId} options={options} /></Card>
    </>
  );
}
