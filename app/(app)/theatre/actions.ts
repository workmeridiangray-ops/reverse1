"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { parseLocalDateTime } from "@/lib/rules/time";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function go(path: string, kind: "ok" | "error", message: string): never {
  revalidatePath(path); revalidatePath("/theatre");
  redirect(`${path}?${new URLSearchParams({ [kind]: message })}`);
}
function pid(f: FormData): string {
  const v = str(f, "procedure_id");
  if (!UUID.test(v)) go("/theatre", "error", "That link is not valid. Reload and try again.");
  return v;
}
function msg(m: string): string {
  if (m.includes("procedures_no_room_overlap")) return "That theatre is already booked for part of that time.";
  if (m.includes("procedures_no_patient_overlap")) return "The patient already has a procedure at that time.";
  if (m.includes("procedure_team_no_staff_overlap")) return "A team member (or the surgeon) is already assigned to another procedure at that time.";
  if (m.includes("procedure_consent_one_active")) return "Active consent is already recorded. Withdraw it first to record a new one.";
  if (/check constraint/.test(m)) return "A value is missing or out of range. Check the form.";
  return friendlyDbError(m);
}

export async function requestProcedure(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  await requireRole("doctor");
  const patient = str(form, "patient_id");
  const surgeon = str(form, "surgeon_id");
  if (!UUID.test(patient)) return { error: "Choose a patient." };
  if (!UUID.test(surgeon)) return { error: "Choose the surgeon." };
  if (str(form, "name").length < 3) return { error: "Name the procedure." };
  const adm = str(form, "admission_id");
  const urgency = ["elective", "urgent", "emergency"].includes(str(form, "urgency")) ? str(form, "urgency") : "elective";
  const { data, error } = await (await createClient()).rpc("request_procedure", { p_patient: patient, p_admission: (UUID.test(adm) ? adm : null) as string, p_surgeon: surgeon, p_name: str(form, "name"), p_urgency: urgency });
  if (error) return { error: msg(error.message) };
  revalidatePath("/theatre");
  redirect(`/theatre/${data}?ok=${encodeURIComponent("Procedure requested. A coordinator will schedule it.")}`);
}

export async function scheduleProcedure(form: FormData): Promise<void> {
  const session = await requireRole("admin", "nurse");
  const id = pid(form); const back = `/theatre/${id}`;
  let start: Date; let end: Date;
  try { start = parseLocalDateTime(str(form, "starts"), session.clinic.timezone); end = parseLocalDateTime(str(form, "ends"), session.clinic.timezone); }
  catch { return go(back, "error", "Enter valid start and end times."); }
  const room = str(form, "room_id");
  if (!UUID.test(room)) go(back, "error", "Choose a theatre.");
  const team = (["anaesthetist", "scrub_nurse", "circulating_nurse", "assistant"] as const)
    .map((role) => ({ user: str(form, role), role })).filter((t) => UUID.test(t.user));
  const { error } = await (await createClient()).rpc("schedule_procedure", { p_proc: id, p_room: room, p_start: start.toISOString(), p_end: end.toISOString(), p_team: team, p_reason: str(form, "reason") || undefined });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", "Scheduled. Complete the checklist and consent before the start time.");
}
export async function tickChecklist(form: FormData): Promise<void> {
  await requireRole("nurse", "doctor");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("tick_checklist", { p_item: str(form, "item_id") });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Recorded. This notes who confirmed the check; it does not replace the check itself.");
}
export async function recordConsent(form: FormData): Promise<void> {
  await requireRole("doctor");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("record_consent", { p_proc: id, p_name: str(form, "consenter"), p_relationship: str(form, "relationship"), p_method: str(form, "method"), p_witness: str(form, "witness"), p_evidence: str(form, "evidence") });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Consent evidence recorded.");
}
export async function withdrawConsent(form: FormData): Promise<void> {
  await requireRole("doctor", "admin");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("withdraw_consent", { p_proc: id, p_reason: str(form, "reason") });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Consent withdrawn. The procedure cannot start until consent is recorded again.");
}
export async function startProcedure(form: FormData): Promise<void> {
  await requireRole("doctor", "nurse");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("start_procedure", { p_proc: id, p_override_reason: str(form, "override") || undefined });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Procedure started.");
}
export async function writeNote(form: FormData): Promise<void> {
  await requireRole("doctor");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("write_procedure_note", { p_proc: id, p_body: str(form, "body"), p_reason: str(form, "reason") || undefined });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Procedure note saved as a new version.");
}
export async function moveToRecovery(form: FormData): Promise<void> {
  await requireRole("doctor", "nurse");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("move_to_recovery", { p_proc: id });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Patient moved to recovery.");
}
export async function completeRecovery(form: FormData): Promise<void> {
  await requireRole("nurse", "doctor");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("complete_recovery", { p_proc: id });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Recovery complete.");
}
export async function cancelProcedure(form: FormData): Promise<void> {
  await requireRole("doctor", "admin", "nurse");
  const id = pid(form);
  const { error } = await (await createClient()).rpc("cancel_procedure", { p_proc: id, p_reason: str(form, "reason") });
  if (error) go(`/theatre/${id}`, "error", msg(error.message));
  go(`/theatre/${id}`, "ok", "Procedure cancelled. The theatre and team are free again.");
}
