import "server-only";
import { sortWorklist, type WorklistItem } from "@/lib/rules/clinical-priority";
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import { localDateKey } from "@/lib/rules/time";
import type { Session } from "@/lib/auth/session";
import type { ServerClient } from "@/lib/supabase/server";
import { getDayAppointments } from "./reception";
import { describeResult, type ResultFlag } from "@/lib/rules/lab-flags";

export interface DoctorWorklistRow extends WorklistItem {
  patientId: string;
  reason: string | null;
  roomName: string | null;
  noteSigned: boolean;
  /** consultation to open for a lab-result item (the note it was ordered from), if any */
  openConsultationId?: string | null;
}

/**
 * The doctor's day: today's appointments plus any of their notes that are
 * unsigned or flagged critical (from any day), ordered by clinical priority.
 */
export async function getDoctorWorklist(supabase: ServerClient, session: Session, now: Date) {
  const today = localDateKey(now, session.clinic.timezone);
  const appts = await getDayAppointments(supabase, session, today, { doctorId: session.userId });
  const apptIds = appts.map((a) => a.id);

  const select =
    "id, appointment_id, patient_id, signed_at, is_critical, critical_reason, created_at, patient:patients!consultations_patient_id_clinic_id_fkey(given_name, family_name), appointment:appointments!consultations_appointment_id_clinic_id_fkey(starts_at, status, reason)";
  const [open, todays] = await Promise.all([
    supabase.from("consultations").select(select).eq("doctor_id", session.userId).or("signed_at.is.null,is_critical.eq.true").limit(200),
    apptIds.length
      ? supabase.from("consultations").select(select).eq("doctor_id", session.userId).in("appointment_id", apptIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (open.error) throw new Error(open.error.message);
  if (todays.error) throw new Error(todays.error.message);
  const notes = new Map([...(open.data ?? []), ...(todays.data ?? [])].map((c) => [c.id, c]));
  const noteByAppt = new Map([...notes.values()].filter((c) => c.appointment_id).map((c) => [c.appointment_id!, c]));

  const rows: DoctorWorklistRow[] = appts.map((a) => {
    const note = noteByAppt.get(a.id);
    return {
      appointmentId: a.id,
      consultationId: note?.id ?? null,
      patientId: a.patientId,
      patientName: a.patientName,
      startsAt: a.startsAt,
      appointmentStatus: a.status,
      unsignedNote: !!note && !note.signed_at,
      noteSigned: !!note?.signed_at,
      critical: !!note?.is_critical,
      criticalReason: note?.critical_reason ?? null,
      carriedOver: false,
      reason: a.reason,
      roomName: a.roomName,
    };
  });

  // Unsigned / critical notes from other days are carried onto today's list.
  for (const note of notes.values()) {
    if (note.appointment_id && apptIds.includes(note.appointment_id)) continue;
    rows.push({
      appointmentId: note.appointment_id,
      consultationId: note.id,
      patientId: note.patient_id,
      patientName: note.patient ? `${note.patient.given_name} ${note.patient.family_name}` : "Unknown patient",
      startsAt: note.appointment ? new Date(note.appointment.starts_at) : new Date(note.created_at),
      appointmentStatus: (note.appointment?.status as AppointmentStatus | undefined) ?? null,
      unsignedNote: !note.signed_at,
      noteSigned: !!note.signed_at,
      critical: note.is_critical,
      criticalReason: note.critical_reason,
      carriedOver: true,
      reason: note.appointment?.reason ?? null,
      roomName: null,
    });
  }

  // Critical lab results this doctor ordered and has not acknowledged: always pulled to the top.
  const { data: labs, error: labErr } = await supabase
    .from("lab_results")
    .select(
      `id, value, unit, flag, entered_at, patient_id,
       test:lab_test_types!lab_results_test_type_id_clinic_id_fkey(name),
       patient:patients!lab_results_patient_id_clinic_id_fkey(given_name, family_name),
       order:lab_orders!lab_results_order_id_clinic_id_fkey!inner(ordered_by, consultation_id)`,
    )
    .in("flag", ["critical_low", "critical_high"])
    .is("acknowledged_at", null)
    .eq("order.ordered_by", session.userId)
    .order("entered_at");
  if (labErr) throw new Error(labErr.message);
  for (const l of labs ?? []) {
    rows.push({
      appointmentId: null,
      consultationId: null,
      openConsultationId: l.order?.consultation_id ?? null,
      labResultId: l.id,
      patientId: l.patient_id,
      patientName: l.patient ? `${l.patient.given_name} ${l.patient.family_name}` : "Unknown patient",
      startsAt: l.entered_at ? new Date(l.entered_at) : null,
      appointmentStatus: null,
      unsignedNote: false,
      noteSigned: false,
      critical: true,
      criticalReason: describeResult(l.test?.name ?? "Result", Number(l.value), l.unit, l.flag as ResultFlag),
      carriedOver: false,
      reason: "Critical lab result: acknowledge",
      roomName: null,
    });
  }

  const sorted = sortWorklist(rows) as Array<DoctorWorklistRow & { bucket: ReturnType<typeof sortWorklist>[number]["bucket"] }>;
  return {
    rows: sorted,
    counts: {
      patientsToday: appts.filter((a) => a.status !== "cancelled" && a.status !== "no_show").length,
      critical: rows.filter((r) => r.critical).length,
      unsigned: rows.filter((r) => r.unsignedNote).length,
      waiting: appts.filter((a) => a.status === "arrived").length,
    },
  };
}
