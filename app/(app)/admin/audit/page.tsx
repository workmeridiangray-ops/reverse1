import type { Metadata } from "next";
import Link from "next/link";
import { DateTimeText } from "@/components/ui/Format";
import { EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { ROLE_LABEL, isRole } from "@/lib/rules/routing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = { view: "Viewed", insert: "Created", update: "Changed", delete: "Deleted" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ patient?: string; action?: string }> }) {
  const session = await requireRole("admin");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("audit_log").select("*").order("occurred_at", { ascending: false }).limit(300);
  if (sp.patient && /^[0-9a-f-]{36}$/.test(sp.patient)) q = q.eq("patient_id", sp.patient);
  if (sp.action && sp.action in ACTION_LABEL) q = q.eq("action", sp.action);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const actorIds = [...new Set(data.map((d) => d.actor_id).filter((x): x is string => !!x))];
  const patientIds = [...new Set(data.map((d) => d.patient_id).filter((x): x is string => !!x))];
  const [actors, patients] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id, full_name").in("id", actorIds) : Promise.resolve({ data: [] }),
    patientIds.length ? supabase.from("patients").select("id, given_name, family_name").in("id", patientIds) : Promise.resolve({ data: [] }),
  ]);
  const actor = new Map((actors.data ?? []).map((a) => [a.id, a.full_name]));
  const patient = new Map((patients.data ?? []).map((p) => [p.id, `${p.given_name} ${p.family_name}`]));
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Audit log"
        description="Who opened or changed what, and when. Entries can't be edited or deleted. Changes list field names only, never their values." />
      <nav aria-label="Filter" className="mb-gutter flex flex-wrap gap-3 text-sm font-bold">
        <Link href="/admin/audit">Everything</Link>
        {Object.entries(ACTION_LABEL).map(([k, v]) => <Link key={k} href={`/admin/audit?action=${k}${sp.patient ? `&patient=${sp.patient}` : ""}`}>{v}</Link>)}
      </nav>
      {data.length === 0 ? <EmptyState title="No entries" /> : (
        <div className="rounded-lg border border-line bg-surface p-2 shadow-card">
          <Table caption="Audit entries, newest first">
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Did</Th><Th>Record</Th><Th>Patient</Th><Th>Fields / reason</Th></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-sm"><DateTimeText at={e.occurred_at} timeZone={tz} /></Td>
                  <Td className="text-sm">{e.actor_id ? actor.get(e.actor_id) ?? "Unknown" : "System"}{e.actor_role && isRole(e.actor_role) ? <span className="block text-ink-500">{ROLE_LABEL[e.actor_role]}</span> : null}</Td>
                  <Td className="font-bold">{ACTION_LABEL[e.action] ?? e.action}</Td>
                  <Td className="text-sm">{e.table_name.replace("_", " ")}</Td>
                  <Td className="text-sm">{e.patient_id ? <Link href={`/admin/audit?patient=${e.patient_id}`}>{patient.get(e.patient_id) ?? "Patient"}</Link> : ""}</Td>
                  <Td className="text-sm text-ink-700">{e.changed_fields?.join(", ") ?? e.reason ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
