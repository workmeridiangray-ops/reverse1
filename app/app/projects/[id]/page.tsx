import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/ui/ActionForm";
import { ButtonLink } from "@/components/ui/Button";
import { Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { Money } from "@/components/ui/Format";
import { Stat } from "@/components/ui/Stat";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { closureChecks, getProject, projectSummary } from "@/lib/server/queries";
import { awardProject, closeProject, startHandover } from "./lifecycle";

export const metadata = { title: "Project" };
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("project.view");
  const { p, s, checks, contract } = await c.run(async (db) => {
    const p = await getProject(db, id);
    const s = await projectSummary(db, id, !c.external);
    const checks = p.status === "handover" || p.status === "closed" ? await closureChecks(db, id) : [];
    const contract = await db.maybe<{ status: string }>("SELECT status FROM contracts WHERE project_id=$1", [id]);
    return { p, s, checks, contract };
  });
  const progress = s.contractValueMinor ? Math.round((s.verifiedValueMinor / s.contractValueMinor) * 1000) / 10 : 0;
  const hid = <input type="hidden" name="project_id" value={id} />;
  return (
    <>
      <PageHeader eyebrow={p.code} title={p.name} description={<span className="flex flex-wrap items-center gap-2">{p.client_name} · {p.location ?? "No location"} <Badge status={p.status} /></span>}
        actions={c.can("bill.view") && c.can("export") ? <ButtonLink href={`/api/export/${id}/boq`} icon="file">Export BOQ CSV</ButtonLink> : undefined} />
      <ProjectTabs c={c} id={id} active="overview" />
      <section aria-label="Financial position" className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Contract value" value={<Money minor={s.contractValueMinor} />} hint={contract ? `Contract ${contract.status}` : "No contract yet"} />
        <Stat label="Physical progress (verified)" value={`${progress}%`} hint={`Verified work value ${(s.verifiedValueMinor / 100).toLocaleString("en-IN")}`} />
        <Stat label="Submitted (claimed)" value={<Money minor={s.claimedMinor} />} />
        <Stat label="Certified (gross)" value={<Money minor={s.certifiedMinor} />} />
        <Stat label="Invoiced (net)" value={<Money minor={s.invoicedMinor} />} />
        <Stat label="Collected" value={<Money minor={s.collectedMinor} />} />
        <Stat label="Outstanding" value={<Money minor={s.outstandingMinor} />} hint={s.disputedMinor ? `of which disputed: ${(s.disputedMinor / 100).toLocaleString("en-IN")}` : undefined} />
        <Stat label="Retention held" value={<Money minor={s.retentionHeldMinor} />} hint={`Advance recovered ${(s.advanceRecoveredMinor / 100).toLocaleString("en-IN")}`} />
      </section>
      <p className="mb-6 text-sm text-ink-500">Physical progress (verified measurements at contract rates) and financial progress (certified, invoiced, collected) are separate measures.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Project details"><DefinitionList items={[["Code", p.code], ["Client", p.client_name], ["Location", p.location ?? "—"], ["Planned", `${p.start_date ?? "—"} → ${p.end_date ?? "—"}`]]} /></Card>
        <Card title="Lifecycle">
          <ol className="mb-4 flex flex-wrap gap-2 text-sm">{["tender", "active", "handover", "closed"].map((x) => <li key={x}><Badge status={x} /></li>)}</ol>
          {p.status === "tender" && c.can("contract.approve") ? <ActionForm action={awardProject} submitLabel="Award project">{hid}<p className="text-sm text-ink-700">Awarding requires an approved contract.</p></ActionForm> : null}
          {p.status === "active" && c.can("project.edit") ? <ActionForm action={startHandover} submitLabel="Start handover">{hid}<p className="text-sm text-ink-700">Moves the project to handover and snagging.</p></ActionForm> : null}
          {p.status === "handover" && c.can("project.edit") ? <ActionForm action={closeProject} submitLabel="Close project" variant="danger" danger>{hid}<p className="text-sm text-ink-700">Closing makes all records read-only. Complete the checklist below first.</p></ActionForm> : null}
          {p.status === "closed" ? <p className="text-ink-700">This project is closed and read-only.</p> : null}
        </Card>
      </div>
      {checks.length ? (
        <Card title="Completion checklist" className="mt-6">
          <ul className="space-y-2">{checks.map((k) => <li key={k.label} className="flex items-center gap-3"><Badge visual={k.ok ? { label: "Done", tone: "ok", icon: "check" } : { label: "Open", tone: "warn", icon: "clock" }} /> {k.label} <span className="text-ink-500">({k.detail})</span></li>)}</ul>
          <p className="mt-3 text-sm text-ink-500">Retention held and defect-period reminders do not settle contractual liability; review the final account on the <Link href={`/app/projects/${id}/bills`}>Bills</Link> tab.</p>
        </Card>
      ) : null}
    </>
  );
}
