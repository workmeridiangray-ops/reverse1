import Link from 'next/link';
import { PageHeader, Table, Td, Badge, fmtDate } from '@/components/ui';
import { requirePlatform } from '@/lib/platform';
import { withTenant, many } from '@/lib/db';
export default async function Businesses({ searchParams }: { searchParams: Promise<{ q?: string }> }) { const { ctx } = await requirePlatform('businesses'); const sp = await searchParams;
  const rows = await withTenant(ctx, q => many<any>(q, `select o.*, s.status sub, p.name plan, s.trial_ends_at, s.current_period_end from orgs o left join subscriptions s on s.org_id=o.id left join plans p on p.id=s.plan_id where o.name ilike $1 or o.slug ilike $1 order by o.created_at desc limit 100`, [`%${sp.q ?? ''}%`]));
  return (<><PageHeader title="Businesses" /><form className="mb-4 flex gap-2"><input name="q" defaultValue={sp.q} className="input max-w-sm" aria-label="Search" placeholder="Search by name" /><button className="btn btn-primary">Search</button></form>
    <Table head={[{ label: 'Business' }, { label: 'Plan' }, { label: 'Subscription' }, { label: 'Status' }, { label: 'Created', hideSm: true }]}>{rows.map((o: any) => <tr key={o.id}><Td><Link href={`/platform/businesses/${o.id}`}>{o.name}</Link></Td><Td>{o.plan}</Td><Td><Badge status={o.sub ?? 'none'} /></Td><Td><Badge status={o.status} /></Td><Td hideSm>{fmtDate(o.created_at)}</Td></tr>)}</Table></>); }
