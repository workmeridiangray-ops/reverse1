"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getPotentialConflicts } from "@/lib/data/appointments";
import { friendlyDbError } from "@/lib/data/errors";
import { hasBlocking, type ScheduleIssue, validateSlot } from "@/lib/rules/scheduling";
import { parseLocalDateTime } from "@/lib/rules/time";
import { createClient } from "@/lib/supabase/server";

export interface AppointmentFormState {
  errors?: Partial<Record<"patient_id" | "doctor_id" | "date" | "time" | "duration", string>>;
  issues?: ScheduleIssue[];
  needsConfirm?: boolean;
  formError?: string;
  values?: Record<string, string>;
}

export async function saveAppointment(_prev: AppointmentFormState, form: FormData): Promise<AppointmentFormState> {
  const session = await requireRole("admin", "receptionist");
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;
  const id = values.id || null;
  const errors: AppointmentFormState["errors"] = {};
  if (!values.patient_id) errors.patient_id = "Choose a patient.";
  if (!values.doctor_id) errors.doctor_id = "Choose a doctor.";
  if (!values.date) errors.date = "Choose a date.";
  if (!values.time) errors.time = "Choose a start time.";
  const minutes = Number.parseInt(values.duration ?? "", 10);
  if (!Number.isInteger(minutes) || minutes <= 0) errors.duration = "Choose a length.";
  if (Object.keys(errors).length) return { errors, values };

  let start: Date;
  try {
    start = parseLocalDateTime(`${values.date}T${values.time}`, session.clinic.timezone);
  } catch {
    return { errors: { time: "Enter a valid date and time." }, values };
  }
  const end = new Date(start.getTime() + minutes * 60_000);
  const candidate = {
    id: id ?? undefined,
    startsAt: start,
    endsAt: end,
    doctorId: values.doctor_id!,
    roomId: values.room_id || null,
    patientId: values.patient_id!,
    status: "scheduled" as const,
  };

  const supabase = await createClient();
  const existing = await getPotentialConflicts(supabase, { start, end, doctorId: candidate.doctorId, roomId: candidate.roomId, patientId: candidate.patientId });
  const issues = validateSlot(candidate, existing, { now: new Date() });
  if (hasBlocking(issues)) return { issues, values };
  if (issues.length > 0 && values.confirm !== "on") return { issues, needsConfirm: true, values };

  const row = {
    patient_id: candidate.patientId,
    doctor_id: candidate.doctorId,
    room_id: candidate.roomId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reason: values.reason?.trim() || null,
  };
  if (id) {
    const { error } = await supabase.from("appointments").update(row).eq("id", id);
    if (error) return { formError: friendlyDbError(error.message), values };
    revalidatePath(`/appointments/${id}`);
    redirect(`/appointments/${id}?saved=1`);
  }
  const { data, error } = await supabase.from("appointments").insert({ ...row, clinic_id: session.clinic.id }).select("id").single();
  if (error) return { formError: friendlyDbError(error.message), values };
  if (values.request_id) {
    // Close the patient's request with the booking just made (the database checks it is the same patient).
    await supabase.from("appointment_requests").update({ status: "booked", appointment_id: data.id }).eq("id", values.request_id).eq("status", "open");
    revalidatePath("/appointments/requests");
  }
  revalidatePath("/reception");
  redirect(`/appointments/${data.id}?saved=1`);
}
