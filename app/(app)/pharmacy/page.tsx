import type { Metadata } from "next";
import { DateText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader, Placeholder } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pharmacy" };
export const dynamic = "force-dynamic";

export default async function PharmacyHome() {
  const session = await requireRole("pharmacist", "admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("prescriptions")
    .select("id, drug_name, dose, route, frequency, duration_days, created_at, patient:patients!prescriptions_patient_id_clinic_id_fkey(given_name, family_name, mrn)")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Pharmacy" />
      <div className="mb-gutter">
        <Placeholder phase="Coming in Phase 3">
          Dispensing will pick stock with the earliest expiry first, and flag a batch that runs out of date before the course ends.
        </Placeholder>
      </div>
      <Card title="Active prescriptions">
        {!data?.length ? <EmptyState title="No active prescriptions" /> : (
          <Table caption="Active prescriptions">
            <thead><tr><Th>Patient</Th><Th>Medicine</Th><Th>Dose</Th><Th>How often</Th><Th>Days</Th><Th>Written</Th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-bold">{r.patient?.given_name} {r.patient?.family_name} <span className="font-mono text-sm font-normal text-ink-500">{r.patient?.mrn}</span></Td>
                  <Td>{r.drug_name}</Td><Td>{r.dose} {r.route}</Td><Td>{r.frequency}</Td>
                  <Td className="font-mono">{r.duration_days ?? ""}</Td>
                  <Td><DateText at={r.created_at} timeZone={session.clinic.timezone} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
