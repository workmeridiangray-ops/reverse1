import type { Metadata } from "next";
import { AdmissionForm } from "@/components/patients/AdmissionForm";
import { PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Request admission" };
export const dynamic = "force-dynamic";

export default async function NewAdmission({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor");
  const { patient } = await searchParams;
  const supabase = await createClient();
  const [patients, doctors, clinic] = await Promise.all([
    supabase.from("patients").select("id, mrn, given_name, family_name").is("archived_at", null).order("family_name").limit(1000),
    supabase.from("profiles").select("id, full_name").eq("role", "doctor").eq("active", true).order("full_name"),
    supabase.from("clinics").select("require_deposit_for_elective").eq("id", session.clinic.id).single(),
  ]);
  return (
    <>
      <PageHeader eyebrow="Admissions" title="Request an admission" description="The patient waits for a bed until a nurse or front desk allocates one." />
      <AdmissionForm
        patients={(patients.data ?? []).map((p) => ({ id: p.id, label: `${p.family_name}, ${p.given_name} (${p.mrn})` }))}
        doctors={(doctors.data ?? []).map((d) => ({ id: d.id, name: d.full_name }))}
        requireDeposit={clinic.data?.require_deposit_for_elective ?? true}
        defaultPatient={patient}
      />
    </>
  );
}
