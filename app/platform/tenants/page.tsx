import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { DateText } from "@/components/ui/Format";
import { Card, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requirePlatform } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";

export const metadata = { title: "Businesses" };
export default async function Tenants({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const a = await requirePlatform(); const q = ((await searchParams).q ?? "").slice(0, 60);
  const rows = await tx({ userId: a.user.id, platform: true }, (db) => db.q<{ id: string; name: string; status: string; created_at: Date; plan: string; members: number; is_demo: boolean }>(
    "SELECT t.id,t.name,t.status,t.created_at,p.name plan,t.is_demo,(SELECT count(*) FROM memberships m WHERE m.tenant_id=t.id)::int members FROM tenants t JOIN plans p ON p.id=t.plan_id WHERE ($1='' OR t.name ILIKE '%'||$1||'%') ORDER BY t.created_at DESC LIMIT 200", [q]));
  return (
    <>
      <PageHeader title="Businesses" />
      <form className="mb-4 flex items-end gap-3" role="search"><label className="text-sm font-bold">Search<input name="q" defaultValue={q} className="ml-2 min-h-touch rounded border border-ink-500 px-2" /></label><button className="min-h-touch rounded border border-ink-500 px-4 font-bold">Search</button></form>
      <Card><Table caption="Businesses"><thead><tr><Th>Name</Th><Th>Status</Th><Th>Plan</Th><Th className="text-right">Members</Th><Th>Created</Th></tr></thead>
        <tbody>{rows.map((t) => <tr key={t.id}><Td><Link href={`/platform/tenants/${t.id}`} className="font-bold">{t.name}</Link>{t.is_demo ? <span className="ml-2 text-caption text-ink-500">(demo data)</span> : null}</Td><Td><Badge status={t.status} /></Td><Td>{t.plan}</Td><Td className="text-right">{t.members}</Td><Td><DateText at={t.created_at} /></Td></tr>)}</tbody></Table></Card>
    </>
  );
}
