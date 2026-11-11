import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AllergyPanel } from "@/components/clinical/AllergyPanel";
import { Card, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { getAllergies } from "@/lib/data/clinical";
import { suggestedDrugNames } from "@/lib/rules/drug-catalog";
import { createClient } from "@/lib/supabase/server";
import { PrescribeForm } from "./PrescribeForm";

export const metadata: Metadata = { title: "Prescribe" };
export const dynamic = "force-dynamic";

export default async function PrescribePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const session = await requireRole("doctor");
  const { id } = await params;
  await searchParams;
  const supabase = await createClient();
  const { data: note } = await supabase
    .from("consultations")
    .select("id, doctor_id, patient_id, patient:patients!consultations_patient_id_clinic_id_fkey(given_name, family_name, mrn)")
    .eq("id", id)
    .maybeSingle();
  if (!note || !note.patient || note.doctor_id !== session.userId) notFound();
  await logAccess(supabase, "consultations", id, "prescribing");
  const allergies = await getAllergies(supabase, note.patient_id);
  const back = `/doctor/notes/${id}/prescribe`;

  return (
    <>
      <PageHeader eyebrow="Prescribing" title={`${note.patient.given_name} ${note.patient.family_name}`}
        description={<span className="font-mono">{note.patient.mrn}</span>} />
      <div className="grid gap-gutter lg:grid-cols-[1fr_22rem]">
        <Card title="New prescription">
          <PrescribeForm consultationId={id} patientId={note.patient_id} allergies={allergies} drugNames={suggestedDrugNames()} />
        </Card>
        <AllergyPanel patientId={note.patient_id} allergies={allergies} backPath={back} compactTitle />
      </div>
    </>
  );
}
