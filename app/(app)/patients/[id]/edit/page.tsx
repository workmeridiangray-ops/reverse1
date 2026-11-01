import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PatientForm } from "@/components/patients/PatientForm";
import { PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { consentState } from "@/lib/rules/patient";
import { localDateKey } from "@/lib/rules/time";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit patient" };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("admin", "receptionist");
  const { id } = await params;
  const supabase = await createClient();
  const { data: p } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  await logAccess(supabase, "patients", id, "edit");
  const state = consentState(
    { consentTreatmentAt: p.consent_treatment_at, consentDataProcessingAt: p.consent_data_processing_at, consentCommunication: p.consent_communication, consentVersion: p.consent_version },
    session.clinic.consentVersion,
  );
  return (
    <>
      <PageHeader eyebrow={`Patients · ${p.mrn}`} title={`Edit ${p.given_name} ${p.family_name}`} />
      <PatientForm
        consentVersion={session.clinic.consentVersion}
        today={localDateKey(new Date(), session.clinic.timezone)}
        initial={{
          id: p.id, given_name: p.given_name, family_name: p.family_name, date_of_birth: p.date_of_birth, sex_at_birth: p.sex_at_birth,
          phone: p.phone ?? "", email: p.email ?? "", address: p.address ?? "",
          consent_treatment: !!p.consent_treatment_at, consent_data_processing: !!p.consent_data_processing_at,
          consent_communication: p.consent_communication, consentOutdated: state === "outdated",
        }}
      />
    </>
  );
}
