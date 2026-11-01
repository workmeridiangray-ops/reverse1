import type { Metadata } from "next";
import { PatientForm } from "@/components/patients/PatientForm";
import { PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { localDateKey } from "@/lib/rules/time";

export const metadata: Metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  const session = await requireRole("admin", "receptionist");
  return (
    <>
      <PageHeader eyebrow="Patients" title="Register a patient" description="A record number is assigned when you save." />
      <PatientForm
        consentVersion={session.clinic.consentVersion}
        today={localDateKey(new Date(), session.clinic.timezone)}
        initial={{ given_name: "", family_name: "", date_of_birth: "", sex_at_birth: "unknown", phone: "", email: "", address: "",
          consent_treatment: false, consent_data_processing: false, consent_communication: false, consentOutdated: false }}
      />
    </>
  );
}
