import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Table, Td, Badge, Empty } from '@/components/ui';
import { requireSession } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
export const metadata = { title: 'Project portal · Buildline' };
export default async function Portal() { const s = await requireSession(); if (!['client', 'consultant', 'contractor'].includes(s.ctx.role)) redirect('/dashboard');
  const rows = await withTenant(s.ctx, q => many<any>(q, 'select id, code, name, status from projects order by code'));
  return (<><PageHeader title="Your projects" sub="You see only the projects you've been invited to, and only what has been approved for you." /><Table head={[{ label: 'Project' }, { label: 'Status' }]} empty={<Empty title="No projects yet">Ask the contractor to add you to a project.</Empty>}>{rows.map((p: any) => <tr key={p.id}><Td><Link href={`/portal/${p.id}`}>{p.code} · {p.name}</Link></Td><Td><Badge status={p.status} /></Td></tr>)}</Table></>); }
