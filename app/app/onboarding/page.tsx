import Link from "next/link";
import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, Badge, A } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { loadSampleData } from "../actions2";
export const metadata = { title: "Setup checklist" };
export default async function P() {
  const a = await requireCompany("master.read");
  const s = await rd(a, async (c) => { const n = async (t: string) => Number((await c.query(`select count(*) n from ${t}`)).rows[0].n); return { plants: await n("plants"), locs: await n("locations"), wcs: await n("work_centres"), items: await n("items"), boms: await n("boms where status='released'"), routings: await n("routings where status='released'"), customers: await n("customers") }; });
  const steps: [string, boolean, string, string][] = [
    ["Company details", !!a.company.name, "/app/settings", "Name, GSTIN, address, billing email."],
    ["Add a plant", s.plants > 0, "/app/setup", "Where you make things. Your plan sets how many plants you can have."],
    ["Add stock locations (incl. a quarantine bin)", s.locs > 0, "/app/setup", "Stores, quarantine, WIP and dispatch."],
    ["Add work centres", s.wcs > 0, "/app/setup", "With hourly cost rate and overhead %."],
    ["Add items", s.items > 0, "/app/items", "Manufactured, purchased and subcontracted. Import by CSV from Settings → Import."],
    ["Release a BOM and routing", s.boms > 0 && s.routings > 0, "/app/boms", "A released routing is needed to release a job."],
    ["Add customers & suppliers", s.customers > 0, "/app/partners", "Needed for orders and purchasing."],
    ["Invite your team", false, "/app/settings", "Planners, buyers, storekeepers, supervisors, operators, quality."],
  ];
  const done = steps.filter((x) => x[1]).length;
  return <Page title="Welcome checklist" sub={`${done} of ${steps.length} steps done. Progress is saved automatically from your data.`}>
    <div className="grid gap-4 lg:grid-cols-3"><div className="space-y-2 lg:col-span-2">{steps.map(([t, ok, h, d]) => <div key={t} className="card flex items-center justify-between gap-3 p-4"><div><div className="font-medium">{ok ? "✓ " : "○ "}{t}</div><div className="text-sm text-muted">{d}</div></div><Link href={h} className={ok ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>{ok ? "Review" : "Do this"}</Link></div>)}</div>
      <Card title="Explore with sample data"><p className="mb-3 text-sm text-muted">Adds a small pump factory (items, BOMs, routings, customer, supplier, stock). Everything is flagged <Badge s="draft" label="SAMPLE" /> by the “SAMPLE” code prefix and the company shows a demo marker. Only available while the workspace has no items.</p>
        {s.items === 0 ? <ActionForm action={loadSampleData} submit="Load sample data" confirm="Add sample data to this workspace?" secondary>{null}</ActionForm> : <p className="text-sm text-muted">Sample data is only offered on an empty workspace. Use <A href="/app/settings">Settings → Import</A> for your own data.</p>}</Card></div>
  </Page>;
}
