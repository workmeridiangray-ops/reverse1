import { redirect } from 'next/navigation';
import { PageHeader, Card } from '@/components/ui';
import { EntityForm } from '@/components/EntityViews';
import { entityPage, optionsFor } from '@/lib/page-helpers';
import { withTenant } from '@/lib/db';
export default async function NewOrgEntity({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params; const { e, s, perms } = await entityPage(entity, null);
  if (!perms.has(`${e.module}:create`)) redirect('/denied');
  const options = await withTenant(s.ctx, q => optionsFor(q, e, null));
  return (<><PageHeader title={`New ${e.singular.toLowerCase()}`} crumbs={[{ href: `/o/${e.key}`, label: e.plural }, { label: 'New' }]} /><Card><EntityForm e={e} pid={null} options={options} /></Card></>);
}
