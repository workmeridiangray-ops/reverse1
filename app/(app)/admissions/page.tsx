import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { listAdmissions } from "@/lib/data/inpatient";
import type { AdmissionStatus } from "@/lib/rules/admission";
import { ADMISSION_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admissions" };
export const dynamic = "force-dynamic";

const TABS: Array<{ key: string; label: string; statuses: AdmissionStatus[] }> = [
  { key: "open", label: "Current", statuses: ["requested", "admitted"] },
  { key: "discharged", label: "Discharged", statuses: ["discharged"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

export default async function Admissions({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor", "nurse", "pharmacist");
  const { tab, error } = await searchParams;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0]!;
  const rows = await listAdmissions(await createClient(), current.statuses);
  const tz = session.clinic.timezone;
  const canRequest = ["admin", "receptionist", "doctor"].includes(session.role);
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Admissions" actions={canRequest ? <ButtonLink href="/admissions/new" variant="primary" icon="plus">Request admission</ButtonLink> : null} />
      {error ? <div className="mb-gutter"><Alert tone="danger" title="That didn't work">{error}</Alert></div> : null}
      <nav aria-label="Admission lists" className="mb-gutter flex gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admissions?tab=${t.key}`} aria-current={t.key === current.key ? "page" : undefined}
            className="flex min-h-touch items-center rounded px-4 font-bold no-underline hover:bg-sunken aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700">{t.label}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? <EmptyState title={`No ${current.label.toLowerCase()} admissions`} /> : (
          <Table caption={`${current.label} admissions`}>
            <thead><tr><Th>Patient</Th><Th>Status</Th><Th>Bed</Th><Th>Type</Th><Th>Attending</Th><Th>Requested</Th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <Td><Link href={`/admissions/${a.id}`} className="font-bold">{a.patientName}</Link><br /><span className="text-sm text-ink-500">{a.mrn} · {a.reason}</span></Td>
                  <Td><Badge visual={ADMISSION_VISUAL[a.status]} size="sm" />{a.authorised && a.status === "admitted" ? <><br /><span className="text-caption text-ink-500">Discharge authorised</span></> : null}</Td>
                  <Td className="font-mono">{a.bed ?? "—"}</Td>
                  <Td>{a.type === "emergency" ? "Emergency" : "Elective"}</Td>
                  <Td>{a.attending}</Td>
                  <Td><DateTimeText at={a.requestedAt} timeZone={tz} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
