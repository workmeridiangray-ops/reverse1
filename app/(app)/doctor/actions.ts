"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { validateCriticalFlag } from "@/lib/rules/clinical-priority";
import { validateNote, type NoteDraft } from "@/lib/rules/notes";
import { createClient } from "@/lib/supabase/server";

/** Open (or create) the note for an appointment, then go to it. */
export async function startNote(form: FormData): Promise<void> {
  const session = await requireRole("doctor");
  const appointmentId = String(form.get("appointment_id") ?? "");
  const supabase = await createClient();
  const { data: existing } = await supabase.from("consultations").select("id").eq("appointment_id", appointmentId).maybeSingle();
  if (existing) redirect(`/doctor/notes/${existing.id}`);
  const { data: appt } = await supabase.from("appointments").select("patient_id, doctor_id").eq("id", appointmentId).maybeSingle();
  if (!appt) redirect("/doctor?error=" + encodeURIComponent("Appointment not found."));
  if (appt.doctor_id !== session.userId) redirect("/doctor?error=" + encodeURIComponent("This appointment is booked with another doctor."));
  const { data, error } = await supabase
    .from("consultations")
    .insert({ clinic_id: session.clinic.id, appointment_id: appointmentId, patient_id: appt.patient_id, doctor_id: session.userId })
    .select("id")
    .single();
  if (error) redirect("/doctor?error=" + encodeURIComponent(friendlyDbError(error.message)));
  redirect(`/doctor/notes/${data.id}`);
}

export interface NoteState {
  errors?: string[];
  saved?: boolean;
}

export async function saveNote(_prev: NoteState, form: FormData): Promise<NoteState> {
  const session = await requireRole("doctor");
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent") === "sign" ? "sign" : "save";
  const signed = form.get("signed") === "true";
  const draft: NoteDraft = {
    subjective: String(form.get("subjective") ?? ""),
    objective: String(form.get("objective") ?? ""),
    assessment: String(form.get("assessment") ?? ""),
    plan: String(form.get("plan") ?? ""),
    isCritical: form.get("is_critical") === "on",
    criticalReason: String(form.get("critical_reason") ?? "").trim() || null,
  };
  // Signed notes: only the critical flag can still change (resolving it).
  const issues = signed ? validateCriticalFlag(draft.isCritical, draft.criticalReason) : validateNote(draft, intent);
  if (issues.length) return { errors: issues };

  const supabase = await createClient();
  const update = signed
    ? { is_critical: draft.isCritical, critical_reason: draft.isCritical ? draft.criticalReason : null }
    : {
        subjective: draft.subjective,
        objective: draft.objective,
        assessment: draft.assessment,
        plan: draft.plan,
        is_critical: draft.isCritical,
        critical_reason: draft.isCritical ? draft.criticalReason : null,
        ...(intent === "sign" ? { signed_at: new Date().toISOString(), signed_by: session.userId } : {}),
      };
  const { data, error } = await supabase.from("consultations").update(update).eq("id", id).select("id");
  if (error) return { errors: [friendlyDbError(error.message)] };
  if (!data?.length) return { errors: ["You can only edit your own notes."] };
  revalidatePath("/doctor");
  revalidatePath(`/doctor/notes/${id}`);
  if (intent === "sign") redirect(`/doctor?signed=${id}`);
  return { saved: true };
}
