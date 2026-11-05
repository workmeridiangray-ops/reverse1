import { DateTimeText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requirePlatform } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";

export const metadata = { title: "Leads" };
export default async function Leads() {
  const a = await requirePlatform();
  const rows = await tx({ userId: a.user.id, platform: true }, (db) => db.q<{ id: number; kind: string; name: string; email: string; company: string | null; message: string | null; created_at: Date }>("SELECT * FROM leads ORDER BY id DESC LIMIT 200"));
  return (<><PageHeader title="Demo and contact requests" />{rows.length === 0 ? <EmptyState title="No requests yet" /> : <Card><Table caption="Leads"><thead><tr><Th>When</Th><Th>Type</Th><Th>Name</Th><Th>Email</Th><Th>Company</Th><Th>Message</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><Td><DateTimeText at={r.created_at} /></Td><Td>{r.kind}</Td><Td>{r.name}</Td><Td>{r.email}</Td><Td>{r.company ?? "—"}</Td><Td className="max-w-md break-words">{r.message ?? "—"}</Td></tr>)}</tbody></Table></Card>}</>);
}
