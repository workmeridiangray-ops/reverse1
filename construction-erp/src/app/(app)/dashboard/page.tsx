import Link from 'next/link';
import { PageHeader, Card, Stat, Table, Td, Badge, Money, Empty, Alert } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { decisions } from '@/lib/inbox';
import { onboardingSteps } from '@/lib/onboarding';
export const metadata = { title: 'Dashboard · Buildline' };

export default async function Dashboard() {
  const s = await requireSession(); const perms = await permSet(s);
  const data = await withTenant(s.ctx, async q => {
    const projects = await many<any>(q, `select p.id, p.code, p.name, p.status,
      coalesce((select sum(round(qty*rate_paise)) from boq_items b where b.project_id = p.id),0) contract_value,
      coalesce((select sum(submitted_paise) from ra_bills b where b.project_id = p.id and b.status <> 'rejected'),0) submitted,
      coalesce((select max(certified_gross_paise) from ra_bills b where b.project_id = p.id and b.status in ('certified','invoiced')),0) certified,
      coalesce((select sum(amount_paise) from invoices i where i.project_id = p.id),0) invoiced,
      coalesce((select sum(collected_paise) from invoices i where i.project_id = p.id),0) collected
      from projects p order by p.status = 'closed', p.created_at desc`);
    const inbox = await decisions(q, perms, s.user.id);
    const recent = await many<any>(q, `select action, entity, at from audit_log where actor_id = $1 order by at desc limit 6`, [s.user.id]);
    return { projects, inbox, recent, steps: await onboardingSteps(q, s.org.id) };
  });
  const incomplete = data.steps.filter(x => !x.done);
  return (
    <>
      <PageHeader title="Dashboard" sub={`${s.org.name} — portfolio at a glance`} actions={perms.has('tender:create') ? <Link href="/tenders" className="btn btn-primary">New tender</Link> : null} />
      {incomplete.length > 0 && perms.has('settings:configure') && (
        <div className="mb-6"><Alert kind="info" title={`Finish setting up your workspace (${data.steps.length - incomplete.length}/${data.steps.length})`}>Next: <Link href={incomplete[0].href}>{incomplete[0].label}</Link>. <Link href="/onboarding">See the full checklist</Link></Alert></div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Active projects" value={data.projects.filter((p: any) => p.status !== 'closed').length} />
        <Stat label="Waiting for you" value={data.inbox.length} sub={<Link href="/inbox">Open decisions inbox</Link>} />
        <Stat label="Certified (all projects)" value={<Money v={data.projects.reduce((a: bigint, p: any) => a + BigInt(p.certified), 0n)} />} />
        <Stat label="Collected" value={<Money v={data.projects.reduce((a: bigint, p: any) => a + BigInt(p.collected), 0n)} />} sub="Cash actually received" />
      </div>
      <Card title="Projects" className="mb-6">
        <Table head={[{ label: 'Project' }, { label: 'Status' }, { label: 'Contract value', num: true, hideSm: true }, { label: 'Submitted', num: true, hideSm: true }, { label: 'Certified', num: true }, { label: 'Invoiced', num: true, hideSm: true }, { label: 'Collected', num: true }]}
          empty={<Empty title="No projects yet" action={perms.has('tender:create') ? <Link className="btn btn-primary" href="/tenders">Start with a tender</Link> : null}>Projects are created when an approved tender estimate is awarded.</Empty>}>
          {data.projects.map((p: any) => (
            <tr key={p.id}><Td><Link href={`/p/${p.id}`}>{p.code}</Link><div className="text-xs text-muted">{p.name}</div></Td><Td><Badge status={p.status} /></Td>
              <Td num hideSm><Money v={p.contract_value} /></Td><Td num hideSm><Money v={p.submitted} /></Td><Td num><Money v={p.certified} /></Td><Td num hideSm><Money v={p.invoiced} /></Td><Td num><Money v={p.collected} /></Td></tr>
          ))}
        </Table>
        <p className="help mt-2">Submitted, certified, invoiced and collected are kept separate on purpose. Certified is cumulative gross value before recoveries.</p>
      </Card>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Needs your decision" actions={<Link href="/inbox" className="text-sm">View all</Link>}>
          {data.inbox.length === 0 ? <Empty title="Nothing waiting">You're all caught up.</Empty> :
            <ul className="divide-y divide-line">{data.inbox.slice(0, 6).map((i: any) => <li key={`${i.ent}${i.id}${i.kind}`} className="py-2 flex justify-between gap-3"><Link href={`/p/${i.project_id}/e/${i.ent}/${i.id}`}>{i.kind} · {i.ref}</Link><span className="text-sm text-muted">{i.project_code}</span></li>)}</ul>}
        </Card>
        <Card title="Your recent activity">
          {data.recent.length === 0 ? <Empty title="No activity yet" /> :
            <ul className="divide-y divide-line">{data.recent.map((r: any, i: number) => <li key={i} className="py-2 flex justify-between text-sm"><span>{r.action.replace(/[._]/g, ' ')}</span><time className="text-muted">{new Date(r.at).toLocaleString('en-IN')}</time></li>)}</ul>}
        </Card>
      </div>
    </>
  );
}
