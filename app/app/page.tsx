import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Money } from "@/components/ui/Format";
import { Stat } from "@/components/ui/Stat";
import { requireCtx } from "@/lib/server/auth";
import { projectSummary } from "@/lib/server/queries";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const c = await requireCtx(undefined, { allowLocked: true });
  const { welcome } = await searchParams;
  const data = await c.run(async (db) => {
    const projects = await db.q<{ id: string; code: string; name: string; status: string }>("SELECT id,code,name,status FROM projects WHERE status <> 'closed' ORDER BY created_at DESC LIMIT 50");
    const totals = { cv: 0, certified: 0, invoiced: 0, collected: 0, outstanding: 0 };
    if (!c.external && c.can("bill.view")) for (const p of projects) {
      const s = await projectSummary(db, p.id, true);
      totals.cv += s.contractValueMinor; totals.certified += s.certifiedMinor; totals.invoiced += s.invoicedMinor; totals.collected += s.collectedMinor; totals.outstanding += s.outstandingMinor;
    }
    const q = async (sql: string) => db.q<{ project_id: string; code: string; n: number }>(sql);
    const inbox: Array<{ label: string; rows: Array<{ project_id: string; code: string; n: number }>; tab: string }> = [];
    if (c.can("measure.verify")) inbox.push({ label: "Measurements awaiting verification", tab: "measurements", rows: await q("SELECT m.project_id, p.code, count(*)::int n FROM measurements m JOIN projects p ON p.id=m.project_id WHERE m.status='recorded' GROUP BY 1,2") });
    if (c.can("bill.certify")) inbox.push({ label: "Bills awaiting certification", tab: "bills", rows: await q("SELECT b.project_id, p.code, count(*)::int n FROM bills b JOIN projects p ON p.id=b.project_id WHERE b.status='submitted' GROUP BY 1,2") });
    if (c.can("variation.approve") || c.can("variation.decide")) inbox.push({ label: "Variations awaiting a decision", tab: "variations", rows: await q("SELECT v.project_id, p.code, count(*)::int n FROM variations v JOIN projects p ON p.id=v.project_id WHERE v.status='submitted' GROUP BY 1,2") });
    if (c.can("material.approve")) inbox.push({ label: "Material requests awaiting approval", tab: "procurement", rows: await q("SELECT m.project_id, p.code, count(*)::int n FROM material_requests m JOIN projects p ON p.id=m.project_id WHERE m.status='submitted' GROUP BY 1,2") });
    if (c.can("report.verify")) inbox.push({ label: "Daily reports awaiting review", tab: "reports", rows: await q("SELECT d.project_id, p.code, count(*)::int n FROM daily_reports d JOIN projects p ON p.id=d.project_id WHERE d.status='submitted' GROUP BY 1,2") });
    if (c.can("rfi.respond")) inbox.push({ label: "RFIs awaiting a response", tab: "drawings", rows: await q("SELECT r.project_id, p.code, count(*)::int n FROM rfis r JOIN projects p ON p.id=r.project_id WHERE r.status='open' GROUP BY 1,2") });
    if (c.can("drawing.approve")) inbox.push({ label: "Drawing revisions awaiting approval", tab: "drawings", rows: await q("SELECT r.project_id, p.code, count(*)::int n FROM drawing_revisions r JOIN projects p ON p.id=r.project_id WHERE r.status='draft' GROUP BY 1,2") });
    if (c.can("inspection.manage")) inbox.push({ label: "Inspections requested", tab: "quality", rows: await q("SELECT i.project_id, p.code, count(*)::int n FROM inspections i JOIN projects p ON p.id=i.project_id WHERE i.status='requested' GROUP BY 1,2") });
    return { projects, totals, inbox: inbox.filter((i) => i.rows.length) };
  });
  return (
    <>
      <PageHeader title="Dashboard" description={`${c.tenant.name} — what needs your attention.`} />
      {welcome ? <div className="mb-6"><Alert tone="ok" title="Workspace created">Start with <Link href="/app/projects/new">your first project</Link>, then import its BOQ, approve the contract and invite your team.</Alert></div> : null}
      {!c.external && c.can("bill.view") ? (
        <section aria-label="Portfolio" className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Contract value" value={<Money minor={data.totals.cv} />} />
          <Stat label="Certified (gross)" value={<Money minor={data.totals.certified} />} />
          <Stat label="Invoiced" value={<Money minor={data.totals.invoiced} />} />
          <Stat label="Outstanding" value={<Money minor={data.totals.outstanding} />} hint={`Collected ${(data.totals.collected / 100).toLocaleString("en-IN")}`} />
        </section>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Decisions inbox">
          {data.inbox.length === 0 ? <EmptyState title="Nothing is waiting for you">New approvals and reviews will appear here.</EmptyState> : (
            <ul className="space-y-4">
              {data.inbox.map((i) => (
                <li key={i.label}>
                  <p className="font-bold">{i.label}</p>
                  <ul className="mt-1 space-y-1">{i.rows.map((r) => <li key={r.project_id}><Link href={`/app/projects/${r.project_id}/${i.tab}`}>{r.code}</Link> — {r.n}</li>)}</ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Projects" actions={c.can("project.create") ? <Link href="/app/projects/new">New project</Link> : undefined}>
          {data.projects.length === 0 ? <EmptyState title="No projects yet">{c.can("project.create") ? <Link href="/app/projects/new">Create your first project</Link> : "You have not been assigned to a project yet."}</EmptyState> : (
            <ul className="divide-y divide-line">{data.projects.map((p) => <li key={p.id} className="py-2"><Link href={`/app/projects/${p.id}`}>{p.code} — {p.name}</Link></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
