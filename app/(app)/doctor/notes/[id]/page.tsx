import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText } from "@/components/ui/Format";
import { Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { ageInYears } from "@/lib/rules/time";
import { NOTE_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { NoteForm } from "./NoteForm";

export const metadata: Metadata = { title: "Consultation note" };
export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("doctor");
  const { id } = await params;
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
      </div>
    </>
  );
}
