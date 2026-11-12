import { PageHeader, Stat, Money, Card, Table, Td, Badge, fmtDateTime } from '@/components/ui';
import { requirePlatform } from '@/lib/platform';
import { withTenant, one, many } from '@/lib/db';
export const metadata = { title: 'Platform overview · Buildline' };
export default async function Overview() { const { ctx, role } = await requirePlatform('businesses');
  const d = await withTenant(ctx, async q => ({ o: await one<any>(q, `select count(*) total, count(*) filter (where status='trial') trial, count(*) filter (where status='active') active, count(*) filter (where status in ('past_due')) past_due, count(*) filter (where status='suspended') suspended from orgs`),
    rev: ['owner', 'billing'].includes(role) ? await one<any>(q, `select coalesce(sum(total_paise) filter (where status='paid' and paid_at > now() - interval '30 days'),0) paid30, count(*) filter (where status='failed') failed from platform_invoices`) : null,
    jobs: ['owner', 'techops', 'support'].includes(role) ? await one<any>(q, `select count(*) filter (where status='failed') failed, count(*) filter (where status='queued') queued from jobs`) : null,
    inc: await many<any>(q, `select * from incidents where status <> 'resolved' order by created_at desc limit 5`) }));
  return (<><PageHeader title="Platform overview" /><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"><Stat label="Businesses" value={d.o.total} sub={`${d.o.trial} trial · ${d.o.active} active`} /><Stat label="Past due / suspended" value={`${d.o.past_due} / ${d.o.suspended}`} />{d.rev && <Stat label="Paid (30 days)" value={<Money v={d.rev.paid30} />} sub={`${d.rev.failed} failed invoices`} />}{d.jobs && <Stat label="Failed jobs" value={d.jobs.failed} sub={`${d.jobs.queued} queued`} />}</div>
    <Card title="Open incidents">{d.inc.length === 0 ? <p className="text-sm text-muted">No open incidents.</p> : <ul>{d.inc.map((i: any) => <li key={i.id} className="py-1">{i.title} <Badge status={i.severity === 'critical' ? 'critical' : 'open'} label={i.severity} /> <span className="text-xs text-muted">{fmtDateTime(i.created_at)}</span></li>)}</ul>}</Card></>); }
