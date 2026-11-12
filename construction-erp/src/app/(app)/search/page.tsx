import Link from 'next/link';
import { PageHeader, Card, Empty } from '@/components/ui';
import { requireSession } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams; const s = await requireSession(); const t = q.trim();
  const rows = t.length < 2 ? [] : await withTenant(s.ctx, async c => { const l = `%${t.replace(/[%_]/g, m => '\\' + m)}%`; return many<any>(c, `
    select 'Project' kind, code ref, name label, '/p/' || id href from projects where code ilike $1 or name ilike $1
    union all select 'Drawing', number, title, '/p/' || project_id || '/e/drawings/' || id from drawings where number ilike $1 or title ilike $1
    union all select 'RFI', number, location, '/p/' || project_id || '/e/rfis/' || id from rfis where number ilike $1 or question ilike $1
    union all select 'Purchase order', number, '', '/p/' || project_id || '/e/purchase_orders/' || id from purchase_orders where number ilike $1
    union all select 'Material request', number, '', '/p/' || project_id || '/e/material_requests/' || id from material_requests where number ilike $1
    union all select 'Company', name, kind, '/o/parties/' || id from parties where name ilike $1
    union all select 'Snag', number, description, '/p/' || project_id || '/e/snags/' || id from snags where number ilike $1 or description ilike $1 limit 40`, [l]); });
  return (<><PageHeader title={t ? `Results for “${t}”` : 'Search'} /><Card>{t.length < 2 ? <Empty title="Type at least 2 characters" /> : rows.length === 0 ? <Empty title="No matches">Check the spelling, or try a drawing, PO or project number. You only see records you have access to.</Empty> :
    <ul className="divide-y divide-line">{rows.map((r: any, i: number) => <li key={i} className="py-2"><span className="text-xs text-muted mr-2">{r.kind}</span><Link href={r.href}>{r.ref}</Link> <span className="text-muted text-sm">{r.label}</span></li>)}</ul>}</Card></>); }
