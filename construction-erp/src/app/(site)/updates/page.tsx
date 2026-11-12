import { withSystem, many } from '@/lib/db';
import { fmtDate } from '@/components/ui';
export const metadata = { title: 'Updates · Buildline' };
export const dynamic = 'force-dynamic';
export default async function Updates() { const rows = await withSystem(q => many<any>(q, 'select * from announcements where published_at is not null order by published_at desc limit 30'));
  return (<><h1>Product updates</h1><div className="mt-6 space-y-4 max-w-3xl">{rows.length === 0 ? <p className="text-muted">No updates published yet.</p> : rows.map((r: any) => <article key={r.id} className="card p-5"><h2>{r.title}</h2><time className="text-xs text-muted">{fmtDate(r.published_at)}</time><p className="mt-2 whitespace-pre-line">{r.body}</p></article>)}</div></>); }
