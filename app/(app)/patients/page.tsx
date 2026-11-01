import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { DateText } from "@/components/ui/Format";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { consentState } from "@/lib/rules/patient";
import { searchTerm } from "@/lib/rules/search";
import { ageInYears } from "@/lib/rules/time";
import { CONSENT_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Patients" };
export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor");
  const { q, page } = await searchParams;
  const term = searchTerm(q);
  const pageNo = Math.max(0, Number.parseInt(page ?? "0", 10) || 0);
  const supabase = await createClient();
  let query = supabase
    .from("patients")
    .select("id, mrn, given_name, family_name, date_of_birth, sex_at_birth, phone, consent_treatment_at, consent_data_processing_at, consent_communication, consent_version", { count: "exact" })
    .is("archived_at", null)
    .order("family_name")
    .order("given_name")
    .range(pageNo * PAGE, pageNo * PAGE + PAGE - 1);
  if (term) {
    // Every word must match some field: and(or(word1 fields), or(word2 fields)...)
    const groups = term.split(" ").filter(Boolean).map((w) => `or(given_name.ilike.%${w}%,family_name.ilike.%${w}%,mrn.ilike.%${w}%)`);
    query = query.or(`and(${groups.join(",")})`);
  }
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const tz = session.clinic.timezone;
  const now = new Date();
  const canEdit = session.role !== "doctor";

  return (
    <>
      <PageHeader title="Patients" description={`${count ?? 0} ${term ? "matching" : "registered"} patients`}
        actions={canEdit ? <ButtonLink href="/patients/new" variant="primary" icon="plus">Register patient</ButtonLink> : null} />
      <form role="search" className="mb-gutter flex max-w-xl gap-3" action="/patients">
        <label htmlFor="q" className="sr-only">Search patients by name or record number</label>
        <input id="q" name="q" type="search" defaultValue={term ?? ""} placeholder="Name or record number"
          className="min-h-touch flex-1 rounded border border-ink-500 bg-surface px-3" />
        <Button type="submit" variant="secondary" icon="search">Search</Button>
      </form>
      {data.length === 0 ? (
        <EmptyState title={term ? `No patients match “${term}”` : "No patients yet"} />
      ) : (
        <div className="rounded-lg border border-line bg-surface p-2 shadow-card">
          <Table caption="Patients">
            <thead><tr><Th>Name</Th><Th>Record</Th><Th>Date of birth</Th><Th>Phone</Th><Th>Consent</Th><Th><span className="sr-only">Open</span></Th></tr></thead>
            <tbody>
              {data.map((p) => {
                const consent = consentState({ consentTreatmentAt: p.consent_treatment_at, consentDataProcessingAt: p.consent_data_processing_at, consentCommunication: p.consent_communication, consentVersion: p.consent_version }, session.clinic.consentVersion);
                return (
                  <tr key={p.id} className="hover:bg-canvas">
                    <Td><Link href={`/patients/${p.id}`} className="font-bold text-ink-900">{p.family_name}, {p.given_name}</Link></Td>
                    <Td className="font-mono text-sm">{p.mrn}</Td>
                    <Td><DateText at={`${p.date_of_birth}T12:00:00Z`} timeZone="UTC" /> <span className="text-ink-500">({ageInYears(p.date_of_birth, now, tz)} y)</span></Td>
                    <Td className="text-sm">{p.phone ?? <span className="text-ink-500">None</span>}</Td>
                    <Td><Badge visual={CONSENT_VISUAL[consent]} size="sm" /></Td>
                    <Td className="text-right"><Link href={`/patients/${p.id}`} aria-label={`Open ${p.given_name} ${p.family_name}`}><Icon name="arrow-right" /></Link></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
      <nav aria-label="Pagination" className="mt-gutter flex gap-3">
        {pageNo > 0 ? <ButtonLink href={`/patients?${new URLSearchParams({ ...(term ? { q: term } : {}), page: String(pageNo - 1) })}`} icon="chevron-left">Previous</ButtonLink> : null}
        {(count ?? 0) > (pageNo + 1) * PAGE ? <ButtonLink href={`/patients?${new URLSearchParams({ ...(term ? { q: term } : {}), page: String(pageNo + 1) })}`}>Next</ButtonLink> : null}
      </nav>
    </>
  );
}
