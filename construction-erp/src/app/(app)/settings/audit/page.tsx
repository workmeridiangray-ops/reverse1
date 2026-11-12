import { redirect } from 'next/navigation';
import { PageHeader, Table, Td, fmtDateTime, Pager } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
export const metadata = { title: 'Audit trail · Buildline' };
export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) { const s = await requireSession(); const perms = await permSet(s); if (!perms.has('audit:view')) redirect('/denied');
  const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1); const q_ = sp.q ? `%${sp.q}%` : '%';
  const d = await withTenant(s.ctx, async q => ({ rows: await many<any>(q, `select a.*, u.name from audit_log a left join users u on u.id = a.actor_id where a.action ilike $1 or a.entity ilike $1 order by a.id desc limit 50 offset $2`, [q_, (page - 1) * 50]), n: Number((await one<any>(q, 'select count(*) n from audit_log where action ilike $1 or entity ilike $1', [q_]))!.n) }));
  return (<><PageHeader title="Audit trail" sub="Append-only. Records who, what and when — field names and reasons, never passwords or document contents." />
    <form className="mb-4 flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Filter by action, e.g. bill.certify" className="input max-w-sm" aria-label="Filter" /><button className="btn btn-primary">Filter</button></form>
    <Table head={[{ label: 'When' }, { label: 'Who' }, { label: 'Action' }, { label: 'Record', hideSm: true }, { label: 'Detail', hideSm: true }]}>{d.rows.map((r: any) => <tr key={r.id}><Td>{fmtDateTime(r.at)}</Td><Td>{r.name ?? 'system'}<div className="text-xs text-muted">{r.actor_role}</div></Td><Td>{r.action}</Td><Td hideSm>{r.entity}</Td><Td hideSm><code className="text-xs">{JSON.stringify(r.detail).slice(0, 120)}</code></Td></tr>)}</Table>
    <Pager page={page} pages={Math.max(1, Math.ceil(d.n / 50))} base={`/settings/audit${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ''}`} /></>); }
