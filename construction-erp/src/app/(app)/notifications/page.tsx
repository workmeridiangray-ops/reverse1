import Link from 'next/link';
import { PageHeader, Card, Empty, fmtDateTime } from '@/components/ui';
import { requireSession } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { markNotificationsReadAction } from '@/app/actions/auth';
export const metadata = { title: 'Notifications · Buildline' };
export default async function Notifications() {
  const s = await requireSession();
  const rows = await withTenant(s.ctx, q => many<any>(q, 'select * from notifications order by created_at desc limit 100'));
  return (
    <>
      <PageHeader title="Notifications" actions={<form action={markNotificationsReadAction}><button className="btn">Mark all as read</button></form>} />
      <Card>
        {rows.length === 0 ? <Empty title="No notifications yet">Approvals, rejections and payment updates appear here.</Empty> :
          <ul className="divide-y divide-line">{rows.map((n: any) => (
            <li key={n.id} className="py-3 flex gap-3 justify-between"><div><p className={n.read_at ? '' : 'font-semibold'}>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</p>{n.body && <p className="text-sm text-muted">{n.body}</p>}</div><time className="text-xs text-muted whitespace-nowrap">{fmtDateTime(n.created_at)}</time></li>
          ))}</ul>}
      </Card>
    </>
  );
}
