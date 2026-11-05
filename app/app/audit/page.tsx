import { DateTimeText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireCtx } from "@/lib/server/auth";

export const metadata = { title: "Audit trail" };
export default async function Audit({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const c = await requireCtx("audit.view");
  const sp = await searchParams; const page = Math.max(1, Number(sp.page) || 1); const q = (sp.q ?? "").slice(0, 60);
  const rows = await c.run((db) => db.q<{ id: number; at: Date; action: string; entity: string | null; entity_id: string | null; detail: Record<string, unknown>; uname: string | null }>(
    "SELECT a.id,a.at,a.action,a.entity,a.entity_id,a.detail,u.name uname FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ($1='' OR a.action ILIKE '%'||$1||'%') ORDER BY a.id DESC LIMIT 50 OFFSET $2", [q, (page - 1) * 50]));
  return (
    <>
      <PageHeader title="Audit trail" description="Append-only record of sensitive changes. Entries cannot be edited or deleted." />
      <form className="mb-4 flex items-end gap-3" role="search"><label className="text-sm font-bold" htmlFor="q">Action contains<input id="q" name="q" defaultValue={q} className="ml-2 min-h-touch rounded border border-ink-500 px-2" /></label><button className="min-h-touch rounded border border-ink-500 px-4 font-bold">Filter</button></form>
      {rows.length === 0 ? <EmptyState title="No entries" /> : <Card><Table caption="Audit trail"><thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Detail</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><Td><DateTimeText at={r.at} /></Td><Td>{r.uname ?? "system"}</Td><Td className="font-bold">{r.action}</Td><Td className="max-w-md break-words font-mono text-caption">{Object.keys(r.detail).length ? JSON.stringify(r.detail) : "—"}</Td></tr>)}</tbody></Table>
        <nav className="mt-4 flex justify-between text-sm" aria-label="Pagination">{page > 1 ? <a href={`?page=${page - 1}&q=${encodeURIComponent(q)}`}>Newer</a> : <span />}{rows.length === 50 ? <a href={`?page=${page + 1}&q=${encodeURIComponent(q)}`}>Older</a> : null}</nav></Card>}
    </>
  );
}
