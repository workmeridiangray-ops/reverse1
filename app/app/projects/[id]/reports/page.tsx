import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText, todayIso } from "@/components/ui/Format";
import { TextField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { startReport } from "./actions";

export const metadata = { title: "Site reports" };
export default async function Reports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("report.view");
  const { p, rows } = await c.run(async (db) => ({ p: await getProject(db, id), rows: await db.q<{ id: string; report_date: string; status: string; labour_count: number; equipment_hours: number; uname: string | null }>(
    "SELECT r.id,r.report_date,r.status,r.labour_count,r.equipment_hours,u.name uname FROM daily_reports r LEFT JOIN users u ON u.id=r.created_by WHERE r.project_id=$1 ORDER BY r.report_date DESC LIMIT 100", [id]) }));
  return (
    <>
      <PageHeader eyebrow={p.code} title="Daily site reports" description="Evidence against date, labour, equipment and photos. Drafts are saved; a different person reviews." />
      <ProjectTabs c={c} id={id} active="reports" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {rows.length === 0 ? <EmptyState title="No reports yet">{c.can("report.write") ? "Start today's report." : "Verified reports will appear here."}</EmptyState> : (
          <Card><Table caption="Daily reports"><thead><tr><Th>Date</Th><Th>Status</Th><Th className="text-right">Labour</Th><Th className="text-right">Equipment hrs</Th><Th>Author</Th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><Td><Link className="font-bold" href={`/app/projects/${id}/reports/${r.id}`}><DateText at={r.report_date} /></Link></Td><Td><Badge status={r.status} /></Td><Td className="text-right">{r.labour_count}</Td><Td className="text-right">{r.equipment_hours}</Td><Td>{r.uname ?? "—"}</Td></tr>)}</tbody></Table></Card>
        )}
        {c.can("report.write") && p.status !== "closed" && p.status !== "tender" ? (
          <Card title="Start a report"><ActionForm action={startReport} submitLabel="Open report"><input type="hidden" name="project_id" value={id} /><TextField label="Report date" name="report_date" type="date" defaultValue={todayIso()} max={todayIso()} /></ActionForm></Card>
        ) : null}
      </div>
    </>
  );
}
