"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getAllergies } from "@/lib/data/clinical";
import { friendlyDbError } from "@/lib/data/errors";
import { type AllergyCheckStatus, type AllergyFinding, checkAllergies, validateOverrideReason } from "@/lib/rules/allergy";
import { classForAllergen } from "@/lib/rules/drug-catalog";
import { parseDuration, validatePrescription, type PrescriptionErrors } from "@/lib/rules/prescribing";
import { createClient } from "@/lib/supabase/server";

/** Only same-site paths: these actions redirect back to the page that called them. */
function safeBack(raw: FormDataEntryValue | null, fallback: string): string {
  const b = typeof raw === "string" ? raw : "";
  return b.startsWith("/doctor/") && !b.startsWith("//") && !b.includes("\\") ? b : fallback;
}

function back(path: string, params: Record<string, string>): never {
  const [p, existing] = path.split("?");
  const qs = new URLSearchParams(existing ?? "");
  for (const [k, v] of Object.entries(params)) qs.set(k, v);
  revalidatePath(p ?? "/doctor");
  redirect(`${p}?${qs}`);
}

/* ------------------------------ allergies ------------------------------ */

export async function addAllergy(form: FormData): Promise<void> {
  const session = await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const patientId = String(form.get("patient_id") ?? "");
  const allergen = String(form.get("allergen") ?? "").trim();
  const severity = String(form.get("severity") ?? "");
  const reaction = String(form.get("reaction") ?? "").trim() || null;
  if (!allergen) back(path, { error: "Enter what the patient is allergic to." });
  if (!["mild", "moderate", "severe"].includes(severity)) back(path, { error: "Choose how severe the reaction was." });
  const supabase = await createClient();
  const { error } = await supabase.from("patient_allergies").insert({
    clinic_id: session.clinic.id,
    patient_id: patientId,
    kind: "allergy",
    allergen,
    // Resolved by the same catalogue the prescribing check uses. null = recorded but not auto-matchable.
    allergen_class: classForAllergen(allergen),
    severity: severity as "mild" | "moderate" | "severe",
    reaction,
  });
  if (error) back(path, { error: friendlyDbError(error.message) });
  back(path, { ok: "Allergy recorded." });
}

export async function confirmNoKnownAllergies(form: FormData): Promise<void> {
  const session = await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const supabase = await createClient();
  const { error } = await supabase
    .from("patient_allergies")
    .insert({ clinic_id: session.clinic.id, patient_id: String(form.get("patient_id") ?? ""), kind: "nkda" });
  if (error) back(path, { error: friendlyDbError(error.message) });
  back(path, { ok: "Recorded: no known allergies." });
}

export async function removeAllergy(form: FormData): Promise<void> {
  await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) back(path, { error: "Say why this entry is being removed." });
  const supabase = await createClient();
  const { error } = await supabase
    .from("patient_allergies")
    .update({ removed_at: new Date().toISOString(), removed_reason: reason })
    .eq("id", String(form.get("id") ?? ""));
  if (error) back(path, { error: friendlyDbError(error.message) });
  back(path, { ok: "Entry removed. It stays in the audit log." });
}

/* ----------------------------- prescribing ----------------------------- */

export interface PrescribeState {
  errors?: PrescriptionErrors;
  reasonError?: string;
  formError?: string;
  status?: AllergyCheckStatus;
  findings?: AllergyFinding[];
  values?: Record<string, string>;
}

export async function prescribe(_prev: PrescribeState, form: FormData): Promise<PrescribeState> {
  const session = await requireRole("doctor");
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;
  const noteId = values.consultation_id ?? "";
  const path = `/doctor/notes/${noteId}`;

  const input = { drugName: values.drug_name ?? "", dose: values.dose ?? "", route: values.route ?? "", frequency: values.frequency ?? "", durationDays: values.duration_days ?? "" };
  const errors = validatePrescription(input);
  if (Object.keys(errors).length) return { errors, values };

  const supabase = await createClient();
  const { data: note } = await supabase.from("consultations").select("id, patient_id, doctor_id").eq("id", noteId).maybeSingle();
  if (!note || note.doctor_id !== session.userId) return { formError: "You can only prescribe from your own consultation.", values };

  // Authoritative check, on the server, against the current allergy record.
  const allergies = await getAllergies(supabase, note.patient_id);
  const check = checkAllergies(input.drugName, allergies, values.drug_class ? [values.drug_class] : []);
  const reason = (values.override_reason ?? "").trim();
  const reasonError = validateOverrideReason(check, reason);
  if (reasonError) return { reasonError, status: check.status, findings: check.findings, values };

  const { error } = await supabase.from("prescriptions").insert({
    clinic_id: session.clinic.id,
    consultation_id: note.id,
    patient_id: note.patient_id,
    prescriber_id: session.userId,
    drug_name: input.drugName.trim(),
    dose: input.dose.trim(),
    route: input.route,
    frequency: input.frequency.trim(),
    duration_days: parseDuration(input.durationDays as string),
    drug_classes: check.drugClasses,
    allergy_override_reason: reason || null,
    status: "active",
  });
  if (error) return { formError: friendlyDbError(error.message), values };
  back(path, { ok: `Prescribed ${input.drugName.trim()}.` });
}

export async function cancelPrescription(form: FormData): Promise<void> {
  await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const supabase = await createClient();
  const { error } = await supabase.from("prescriptions").update({ status: "cancelled" }).eq("id", String(form.get("id") ?? "")).eq("status", "active");
  if (error) back(path, { error: friendlyDbError(error.message) });
  back(path, { ok: "Prescription cancelled." });
}

/* --------------------------------- labs -------------------------------- */

export async function orderLabs(form: FormData): Promise<void> {
  await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const tests = form.getAll("test_id").map(String).filter(Boolean);
  if (tests.length === 0) back(path, { error: "Choose at least one test." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_lab_order", {
    p_patient: String(form.get("patient_id") ?? ""),
    // The generated type is `string`, but the function accepts NULL for an order not tied to a note.
    p_consultation: (String(form.get("consultation_id") ?? "") || null) as string,
    p_tests: tests,
    p_notes: String(form.get("notes") ?? "").trim() || undefined,
  });
  if (error) back(path, { error: friendlyDbError(error.message) });
  back(path, { ok: "Tests ordered. The laboratory can see them now." });
}

export async function cancelLabOrder(form: FormData): Promise<void> {
  await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) back(path, { error: "Give a reason for cancelling." });
  const supabase = await createClient();
  const { error } = await supabase.from("lab_orders").update({ status: "cancelled", cancelled_reason: reason }).eq("id", String(form.get("id") ?? ""));
  if (error) back(path, { error: friendlyDbError(error.message) });
  back(path, { ok: "Order cancelled." });
}

export async function acknowledgeResult(form: FormData): Promise<void> {
  await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_results").update({ acknowledged_at: new Date().toISOString() }).eq("id", String(form.get("id") ?? "")).select("id");
  if (error) back(path, { error: friendlyDbError(error.message) });
  if (!data?.length) back(path, { error: "Only the ordering doctor can acknowledge this result." });
  back(path, { ok: "Result acknowledged." });
}

export async function releaseResult(form: FormData): Promise<void> {
  await requireRole("doctor");
  const path = safeBack(form.get("back"), "/doctor");
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_results").update({ released_at: new Date().toISOString() }).eq("id", String(form.get("id") ?? "")).select("id");
  if (error) back(path, { error: friendlyDbError(error.message) });
  if (!data?.length) back(path, { error: "Only the ordering doctor can release this result." });
  back(path, { ok: "Result released to the patient." });
}
