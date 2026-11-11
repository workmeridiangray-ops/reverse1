"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { depositProblem } from "@/lib/rules/admission";
import { parseLocalDateTime } from "@/lib/rules/time";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Redirect back to the admission with a message. Messages are always shown, never swallowed. */
function back(id: string, kind: "ok" | "error", message: string): never {
  revalidatePath(`/admissions/${id}`);
  revalidatePath("/admissions");
  revalidatePath("/wards");
  redirect(`/admissions/${id}?${new URLSearchParams({ [kind]: message })}`);
}

function validId(id: string): string {
  if (!UUID.test(id)) redirect("/admissions?error=" + encodeURIComponent("That admission link is not valid."));
  return id;
}

export interface AdmissionFormState {
  errors?: Partial<Record<"patient_id" | "attending_id" | "admission_type" | "reason" | "deposit_reference", string>>;
  formError?: string;
  values?: Record<string, string>;
}

export async function createAdmission(_prev: AdmissionFormState, form: FormData): Promise<AdmissionFormState> {
  const session = await requireRole("admin", "receptionist", "doctor");
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;
  const errors: NonNullable<AdmissionFormState["errors"]> = {};
  if (!UUID.test(values.patient_id ?? "")) errors.patient_id = "Choose a patient.";
  if (!UUID.test(values.attending_id ?? "")) errors.attending_id = "Choose the attending doctor.";
  if (values.admission_type !== "elective" && values.admission_type !== "emergency") errors.admission_type = "Choose elective or emergency.";
  const reason = (values.reason ?? "").trim();
  if (reason.length < 3) errors.reason = "Say why the patient is being admitted.";
  if (reason.length > 500) errors.reason = "Keep the reason under 500 characters.";

  const supabase = await createClient();
  const { data: clinic } = await supabase.from("clinics").select("require_deposit_for_elective").eq("id", session.clinic.id).single();
  const dep = depositProblem((values.admission_type as "elective" | "emergency") ?? "elective", clinic?.require_deposit_for_elective ?? true, values.deposit_reference ?? "");
  if (dep && !errors.admission_type) errors.deposit_reference = dep;
  if (Object.keys(errors).length) return { errors, values };

  const { data, error } = await supabase
    .from("admissions")
    .insert({
      clinic_id: session.clinic.id,
      patient_id: values.patient_id!,
      attending_id: values.attending_id!,
      admission_type: values.admission_type as "elective" | "emergency",
      reason,
      deposit_reference: (values.deposit_reference ?? "").trim() || null,
      expected_discharge_on: values.expected_discharge_on || null,
    })
    .select("id")
    .single();
  if (error) return { formError: friendlyDbError(error.message), values };
  revalidatePath("/admissions");
  redirect(`/admissions/${data.id}?ok=${encodeURIComponent("Admission requested. Give the patient a bed next.")}`);
}

export async function allocateBed(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist", "nurse");
  const id = validId(str(form, "admission_id"));
  const bed = str(form, "bed_id");
  if (!UUID.test(bed)) back(id, "error", "Choose a bed.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("allocate_bed", { p_admission: id, p_bed: bed });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Bed allocated. The patient is now admitted.");
}

export async function transferBed(form: FormData): Promise<void> {
  const session = await requireRole("admin", "nurse");
  const id = validId(str(form, "admission_id"));
  const bed = str(form, "bed_id");
  if (!UUID.test(bed)) back(id, "error", "Choose the bed to move to.");
  let effective: string | undefined;
  const when = str(form, "effective_at");
  if (when) {
    try {
      effective = parseLocalDateTime(when, session.clinic.timezone).toISOString();
    } catch {
      back(id, "error", "Enter a valid transfer time.");
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_bed", { p_admission: id, p_bed: bed, p_effective: effective, p_note: str(form, "note") || undefined });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Transfer recorded. The old bed now needs cleaning.");
}

export async function cancelAdmission(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist", "doctor");
  const id = validId(str(form, "admission_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_admission", { p_admission: id, p_reason: str(form, "reason") });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Admission request cancelled.");
}

export async function reserveBed(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist", "nurse");
  const id = validId(str(form, "admission_id"));
  const bed = str(form, "bed_id");
  if (!UUID.test(bed)) back(id, "error", "Choose a bed to reserve.");
  let from: Date;
  let until: Date;
  try {
    from = parseLocalDateTime(str(form, "from"), session.clinic.timezone);
    until = parseLocalDateTime(str(form, "until"), session.clinic.timezone);
  } catch {
    back(id, "error", "Enter valid start and end times for the reservation.");
  }
  if (until <= from) back(id, "error", "The reservation must end after it starts.");
  const supabase = await createClient();
  const { error } = await supabase.from("bed_reservations").insert({
    clinic_id: session.clinic.id, bed_id: bed, admission_id: id, reserved_from: from.toISOString(), reserved_until: until.toISOString(),
  });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Bed reserved. It does not count as occupied until the patient arrives.");
}

export async function releaseReservation(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist", "nurse");
  const id = validId(str(form, "admission_id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("bed_reservations").update({ status: "released" }).eq("id", str(form, "reservation_id")).select("id");
  if (error) back(id, "error", friendlyDbError(error.message));
  if (!data?.length) back(id, "error", "That reservation no longer exists.");
  back(id, "ok", "Reservation released.");
}

export async function updateExpectedDischarge(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist", "doctor");
  const id = validId(str(form, "admission_id"));
  const version = Number.parseInt(str(form, "row_version"), 10);
  const date = str(form, "expected_discharge_on");
  const supabase = await createClient();
  // Optimistic concurrency: only update if nobody changed the admission since this page was loaded.
  const { data, error } = await supabase
    .from("admissions")
    .update({ expected_discharge_on: date || null })
    .eq("id", id)
    .eq("row_version", Number.isInteger(version) ? version : -1)
    .select("id");
  if (error) back(id, "error", friendlyDbError(error.message));
  if (!data?.length) back(id, "error", "Someone else changed this admission while you were editing. Review the page and try again.");
  back(id, "ok", "Expected discharge date saved.");
}

export async function authoriseDischarge(form: FormData): Promise<void> {
  await requireRole("doctor");
  const id = validId(str(form, "admission_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("authorise_discharge", { p_admission: id, p_summary: str(form, "summary") });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Discharge authorised. Clearances can now be completed.");
}

export async function withdrawAuthorisation(form: FormData): Promise<void> {
  await requireRole("doctor");
  const id = validId(str(form, "admission_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_discharge_authorisation", { p_admission: id, p_reason: str(form, "reason") });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Authorisation withdrawn. The patient stays admitted.");
}

export async function recordClearance(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist", "nurse", "pharmacist");
  const id = validId(str(form, "admission_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_clearance", {
    p_admission: id, p_department: str(form, "department"), p_status: str(form, "status") || "cleared", p_note: str(form, "note") || undefined,
  });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Clearance recorded.");
}

export async function finaliseDischarge(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist", "nurse");
  const id = validId(str(form, "admission_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalise_discharge", { p_admission: id });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Patient discharged. The bed now needs cleaning.");
}

function num(f: FormData, k: string): number | null {
  const v = str(f, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

export async function addObservation(form: FormData): Promise<void> {
  const session = await requireRole("nurse", "doctor");
  const id = validId(str(form, "admission_id"));
  const patientId = str(form, "patient_id");
  const fields = { systolic: num(form, "systolic"), diastolic: num(form, "diastolic"), pulse: num(form, "pulse"), resp_rate: num(form, "resp_rate"), temp_c: num(form, "temp_c"), spo2: num(form, "spo2") };
  if (Object.values(fields).some((v) => Number.isNaN(v))) back(id, "error", "Observations must be numbers.");
  if (Object.values(fields).every((v) => v === null)) back(id, "error", "Enter at least one measurement.");
  const correctsId = str(form, "corrects_id");
  const reason = str(form, "correction_reason");
  if (correctsId && reason.length < 3) back(id, "error", "Say why you are correcting the earlier entry.");
  const supabase = await createClient();
  const { error } = await supabase.from("observations").insert({
    clinic_id: session.clinic.id, admission_id: id, patient_id: patientId, recorded_by: session.userId, ...fields,
    note: str(form, "note") || null, corrects_id: correctsId || null, correction_reason: correctsId ? reason : null,
  });
  if (error) {
    const m = error.message;
    back(id, "error", /check constraint/.test(m) ? "One of the values is outside the range the system accepts. Check the units and try again." : friendlyDbError(m));
  }
  back(id, "ok", correctsId ? "Correction recorded. The original entry is kept." : "Observations recorded.");
}

export async function addCareTask(form: FormData): Promise<void> {
  const session = await requireRole("nurse", "doctor");
  const id = validId(str(form, "admission_id"));
  const title = str(form, "title");
  if (!title) back(id, "error", "Describe the task.");
  let due: Date;
  try {
    due = parseLocalDateTime(str(form, "due_at"), session.clinic.timezone);
  } catch {
    back(id, "error", "Enter when the task is due.");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("care_tasks").insert({ clinic_id: session.clinic.id, admission_id: id, patient_id: str(form, "patient_id"), title, due_at: due.toISOString() });
  if (error) back(id, "error", friendlyDbError(error.message));
  back(id, "ok", "Task added.");
}

export async function recordTask(form: FormData): Promise<void> {
  await requireRole("nurse");
  const id = validId(str(form, "admission_id"));
  const outcome = str(form, "outcome");
  const reason = str(form, "reason");
  if (outcome !== "done" && outcome !== "not_done") back(id, "error", "Choose done or not done.");
  if (outcome === "not_done" && reason.length < 3) back(id, "error", "Say why the task was not done.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_tasks")
    .update({ status: outcome as "done" | "not_done", not_done_reason: outcome === "not_done" ? reason : null })
    .eq("id", str(form, "task_id"))
    .eq("status", "pending")
    .select("id");
  if (error) back(id, "error", friendlyDbError(error.message));
  if (!data?.length) back(id, "error", "That task was already recorded by someone else.");
  back(id, "ok", outcome === "done" ? "Task marked done." : "Task recorded as not done.");
}

export async function setHousekeeping(form: FormData): Promise<void> {
  await requireRole("admin", "nurse");
  const bed = str(form, "bed_id");
  const state = str(form, "state");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_bed_housekeeping", { p_bed: bed, p_state: state });
  revalidatePath("/wards");
  if (error) redirect(`/wards?${new URLSearchParams({ error: friendlyDbError(error.message) })}`);
  redirect(`/wards?${new URLSearchParams({ ok: state === "clean" ? "Bed marked clean and ready." : "Bed cleaning status updated." })}`);
}
