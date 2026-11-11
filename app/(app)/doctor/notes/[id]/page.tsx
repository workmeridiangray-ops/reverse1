import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { AllergyPanel } from "@/components/clinical/AllergyPanel";
import { LabOrderCard } from "@/components/clinical/LabOrderCard";
import { OrderLabsForm } from "@/components/clinical/OrderLabsForm";
import { ButtonLink } from "@/components/ui/Button";
import { Button } from "@/components/ui/Button";
import { getActiveTests, getAllergies, getLabOrdersForPatient, getPrescriptionsForPatient } from "@/lib/data/clinical";
import { cancelPrescription } from "../../clinical-actions";
import { ALLERGY_CHECK_VISUAL } from "@/lib/ui/status";
import type { StoredAllergyStatus } from "@/lib/rules/allergy";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { ageInYears } from "@/lib/rules/time";
import { NOTE_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { NoteForm } from "./NoteForm";

export const metadata: Metadata = { title: "Consultation note" };
export const dynamic = "force-dynamic";

export default async function NotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("doctor");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: note } = await supabase
    .from("consultations")
    .select(
      `id, doctor_id, subjective, objective, assessment, plan, is_critical, critical_reason, signed_at, created_at,
       patient:patients!consultations_patient_id_clinic_id_fkey(id, mrn, given_name, family_name, date_of_birth, sex_at_birth),
       doctor:profiles!consultations_doctor_id_clinic_id_fkey(full_name),
       appointment:appointments!consultations_appointment_id_clinic_id_fkey(starts_at, reason)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!note || !note.patient) notFound();
  await logAccess(supabase, "consultations", id);

  const [allergies, prescriptions, labOrders, tests] = await Promise.all([
    getAllergies(supabase, note.patient!.id),
    getPrescriptionsForPatient(supabase, note.patient!.id),
    getLabOrdersForPatient(supabase, note.patient!.id),
    getActiveTests(supabase),
  ]);
  const backPath = `/doctor/notes/${id}`;
  const tz = session.clinic.timezone;
  const signed = !!note.signed_at;
  const mine = note.doctor_id === session.userId;
  const p = note.patient;

  return (
    <>
      <PageHeader
        eyebrow="Consultation"
        title={`${p.given_name} ${p.family_name}`}
        description={<>{ageInYears(p.date_of_birth, new Date(), tz)} y · {p.sex_at_birth} · <span className="font-mono">{p.mrn}</span></>}
        actions={<Link href="/doctor">Back to my day</Link>}
      />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <div className="grid gap-gutter lg:grid-cols-[1fr_20rem]">
        <Card title={signed ? "Signed note" : "Note"} actions={<Badge visual={signed ? NOTE_VISUAL.signed : NOTE_VISUAL.unsigned} size="sm" />}>
          {signed ? (
            <div className="mb-6 flex flex-col gap-5">
              {(["subjective", "objective", "assessment", "plan"] as const).map((k) => (
                <div key={k}>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{k}</h3>
                  <p className="whitespace-pre-wrap">{note[k] || <span className="text-ink-500">Not recorded</span>}</p>
                </div>
              ))}
            </div>
          ) : null}
          {mine ? (
            <NoteForm
              id={note.id}
              signed={signed}
              note={{ subjective: note.subjective, objective: note.objective, assessment: note.assessment, plan: note.plan, isCritical: note.is_critical, criticalReason: note.critical_reason }}
            />
          ) : (
            <p className="text-ink-700">Written by {note.doctor?.full_name}. Only the author can edit or sign it.</p>
          )}
        </Card>
        <Card title="Visit" as="aside">
          <DefinitionList
            items={[
              ["Doctor", note.doctor?.full_name ?? ""],
              ["Booked for", note.appointment ? <DateTimeText at={note.appointment.starts_at} timeZone={tz} /> : "Walk-in"],
              ["Reason", note.appointment?.reason ?? "Not given"],
              ["Started", <DateTimeText key="s" at={note.created_at} timeZone={tz} />],
              ["Signed", note.signed_at ? <DateTimeText key="g" at={note.signed_at} timeZone={tz} /> : "Not yet"],
            ]}
          />
          <p className="mt-6"><Link href={`/patients/${p.id}`}>Open patient record</Link></p>
        </Card>
        <AllergyPanel patientId={p.id} allergies={allergies} backPath={backPath} editable={mine} />
      </div>
      <div className="mt-gutter grid gap-gutter lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-gutter">
          <Card title="Prescriptions" actions={mine ? <ButtonLink href={`/doctor/notes/${id}/prescribe`} variant="primary" icon="plus" size="sm">Prescribe</ButtonLink> : null}>
            {prescriptions.length === 0 ? <p className="text-ink-500">No prescriptions for this patient.</p> : (
              <ul className="flex flex-col gap-3">
                {prescriptions.map((rx) => (
                  <li key={rx.id} className="rounded border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold">{rx.drug_name} <span className="font-normal text-ink-700">{rx.dose}, {rx.route}, {rx.frequency}{rx.duration_days ? `, ${rx.duration_days} days` : ""}</span></p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge visual={ALLERGY_CHECK_VISUAL[rx.allergy_check_status as StoredAllergyStatus]} size="sm" />
                        <span className="text-sm font-bold capitalize text-ink-700">{rx.status}</span>
                      </div>
                    </div>
                    {rx.allergy_override_reason ? <p className="mt-1 text-sm"><span className="font-bold">Reason given: </span>{rx.allergy_override_reason}</p> : null}
                    {mine && rx.prescriber_id === session.userId && rx.status === "active" ? (
                      <form action={cancelPrescription} className="mt-2">
                        <input type="hidden" name="id" value={rx.id} /><input type="hidden" name="back" value={backPath} />
                        <Button type="submit" size="sm" variant="ghost">Cancel prescription<span className="sr-only"> for {rx.drug_name}</span></Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Laboratory">
            <div className="flex flex-col gap-4">
              {labOrders.length === 0 ? <p className="text-ink-500">No lab orders for this patient.</p> : labOrders.map((o) => (
                <LabOrderCard key={o.id} order={o} tz={tz} backPath={backPath} doctorId={session.userId} />
              ))}
            </div>
            {mine ? (
              <details className="mt-6 border-t border-line pt-4">
                <summary className="cursor-pointer font-bold text-brand-700">Order tests</summary>
                <div className="mt-3"><OrderLabsForm tests={tests} patientId={p.id} consultationId={id} backPath={backPath} /></div>
              </details>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
