import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Table, Td, Badge, Money, Empty } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
export const metadata = { title: 'Tenders · Buildline' };
export default async function Tenders() {
  const s = await requireSession(); const perms = await permSet(s); if (!perms.has('tender:view')) redirect('/denied');
  const rows = await withTenant(s.ctx, q => many<any>(q, `select o.*, p.name client, (select count(*) from estimate_revisions r where r.opportunity_id=o.id) revs from opportunities o left join parties p on p.id=o.client_party_id order by o.created_at desc`));
  return (<><PageHeader title="Tenders & estimates" sub="Price tenders, keep every estimate revision, and award to create the project, BOQ and baseline budget." actions={perms.has('tender:create') && <Link className="btn btn-primary" href="/o/opportunities/new">New tender</Link>} />
    <Table head={[{ label: 'Tender' }, { label: 'Client', hideSm: true }, { label: 'Revisions', num: true, hideSm: true }, { label: 'Status' }]} empty={<Empty title="No tenders yet">Create a tender, import the BOQ and build up rates.</Empty>}>
      {rows.map((o: any) => <tr key={o.id}><Td><Link href={`/tenders/${o.id}`}>{o.name}</Link></Td><Td hideSm>{o.client ?? '—'}</Td><Td num hideSm>{o.revs}</Td><Td><Badge status={o.status} /></Td></tr>)}
    </Table></>);
}
