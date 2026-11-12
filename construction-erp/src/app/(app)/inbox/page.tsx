import Link from 'next/link';
import { PageHeader, Table, Td, Empty, fmtDateTime } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant } from '@/lib/db';
import { decisions } from '@/lib/inbox';
export const metadata = { title: 'Decisions inbox · Buildline' };
export default async function Inbox() {
  const s = await requireSession(); const perms = await permSet(s);
  const items = await withTenant(s.ctx, q => decisions(q, perms, s.user.id));
  return (
    <>
      <PageHeader title="Decisions inbox" sub="Everything waiting for you to act on, oldest first." />
      <Table head={[{ label: 'What' }, { label: 'Reference' }, { label: 'Project', hideSm: true }, { label: 'Next step' }, { label: 'Waiting since', hideSm: true }]}
        empty={<Empty title="You're all caught up" >Approvals, verifications and follow-ups will appear here when something needs you.</Empty>}>
        {items.map((i: any) => (
          <tr key={`${i.ent}-${i.id}-${i.kind}`}>
            <Td><Link href={`/p/${i.project_id}/e/${i.ent}/${i.id}`}>{i.kind}</Link></Td><Td>{i.ref}</Td><Td hideSm>{i.project_code}</Td><Td>{i.act}</Td><Td hideSm>{fmtDateTime(i.at)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
