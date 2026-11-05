import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { TextField, SelectField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireCtx } from "@/lib/server/auth";

export const metadata = { title: "Projects" };
const PAGE = 20;
export default async function Projects({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const c = await requireCtx("project.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().slice(0, 60);
  const status = ["tender", "active", "handover", "closed"].includes(sp.status ?? "") ? sp.status! : "";
  const { rows, total } = await c.run(async (db) => {
    const where = `WHERE ($1 = '' OR code ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%' OR client_name ILIKE '%'||$1||'%') AND ($2 = '' OR status = $2)`;
    const rows = await db.q<{ id: string; code: string; name: string; client_name: string; status: string; location: string | null }>(
      `SELECT id,code,name,client_name,status,location FROM projects ${where} ORDER BY created_at DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, [q, status]);
    const total = (await db.one<{ n: number }>(`SELECT count(*)::int n FROM projects ${where}`, [q, status])).n;
    return { rows, total };
  });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader title="Projects" actions={c.can("project.create") ? <ButtonLink href="/app/projects/new" variant="primary" icon="plus">New project</ButtonLink> : undefined} />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-4" role="search">
          <TextField label="Search" name="q" defaultValue={q} optional placeholder="Code, name or client" />
          <SelectField label="Status" name="status" defaultValue={status} optional>
            <option value="">All</option><option value="tender">Tender</option><option value="active">Active</option><option value="handover">Handover</option><option value="closed">Closed</option>
          </SelectField>
          <button className="min-h-touch rounded border border-ink-500 px-4 font-bold">Filter</button>
          {(q || status) ? <Link href="/app/projects">Clear</Link> : null}
        </form>
      </Card>
      {rows.length === 0 ? <EmptyState title={q || status ? "No projects match these filters" : "No projects yet"}>{c.can("project.create") && !q && !status ? <Link href="/app/projects/new">Create your first project</Link> : "Adjust the filters or clear them."}</EmptyState> : (
        <Card>
          <Table caption="Projects">
            <thead><tr><Th>Code</Th><Th>Name</Th><Th>Client</Th><Th>Location</Th><Th>Status</Th></tr></thead>
            <tbody>{rows.map((p) => <tr key={p.id}><Td><Link href={`/app/projects/${p.id}`} className="font-bold">{p.code}</Link></Td><Td>{p.name}</Td><Td>{p.client_name}</Td><Td>{p.location ?? "—"}</Td><Td><Badge status={p.status} /></Td></tr>)}</tbody>
          </Table>
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <span>Page {page} of {pages} · {total} project(s)</span>
            <span className="flex gap-4">{page > 1 ? <Link href={qs(page - 1)}>Previous</Link> : null}{page < pages ? <Link href={qs(page + 1)}>Next</Link> : null}</span>
          </nav>
        </Card>
      )}
    </>
  );
}
