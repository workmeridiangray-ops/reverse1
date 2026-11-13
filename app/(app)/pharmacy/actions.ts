"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function go(path: string, kind: "ok" | "error", message: string): never {
  revalidatePath(path); revalidatePath("/pharmacy"); revalidatePath("/pharmacy/stock");
  redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ [kind]: message })}`);
}
function uid(f: FormData, k: string, back: string): string {
  const v = str(f, k);
  if (!UUID.test(v)) go(back, "error", "That link is not valid. Reload and try again.");
  return v;
}
const int = (f: FormData, k: string, back: string, label: string, max = 100000): number => {
  const n = Number(str(f, k));
  if (!Number.isInteger(n) || n < 1 || n > max) go(back, "error", `${label} must be a whole number from 1 to ${max}.`);
  return n;
};
function msg(m: string): string {
  if (/stock_batches_medicine_id_batch_no_key/.test(m)) return "That batch number already exists for this medicine.";
  if (/medicines_clinic_id_name_strength_form_key/.test(m)) return "That medicine already exists.";
  if (/check constraint/.test(m)) return "A value is out of range or empty. Check the form.";
  return friendlyDbError(m);
}

export async function dispense(form: FormData): Promise<void> {
  await requireRole("pharmacist");
  const rx = uid(form, "prescription_id", "/pharmacy");
  const back = `/pharmacy/prescriptions/${rx}`;
  const witness = str(form, "witness_id");
  const { error } = await (await createClient()).rpc("dispense", { p_rx: rx, p_batch: uid(form, "batch_id", back), p_qty: int(form, "qty", back, "Quantity"), p_witness: (UUID.test(witness) ? witness : undefined) as string });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", "Dispensed and stock updated.");
}
export async function requestSubstitution(form: FormData): Promise<void> {
  await requireRole("pharmacist");
  const rx = uid(form, "prescription_id", "/pharmacy");
  const back = `/pharmacy/prescriptions/${rx}`;
  const { error } = await (await createClient()).rpc("request_substitution", { p_rx: rx, p_medicine: uid(form, "medicine_id", back), p_reason: str(form, "reason") });
  if (error) go(back, "error", /substitutions_prescription_id_medicine_id_key/.test(error.message) ? "A substitution for that medicine was already requested." : msg(error.message));
  go(back, "ok", "Substitution requested. The prescriber has been notified.");
}
export async function decideSubstitution(form: FormData): Promise<void> {
  await requireRole("doctor");
  const rx = uid(form, "prescription_id", "/pharmacy");
  const back = `/pharmacy/prescriptions/${rx}`;
  const approve = str(form, "decision") === "approve";
  const { error } = await (await createClient()).rpc("decide_substitution", { p_sub: uid(form, "substitution_id", back), p_approve: approve });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", approve ? "Substitution approved." : "Substitution rejected.");
}
export async function requestReturn(form: FormData): Promise<void> {
  await requireRole("pharmacist");
  const rx = uid(form, "prescription_id", "/pharmacy");
  const back = `/pharmacy/prescriptions/${rx}`;
  const { error } = await (await createClient()).rpc("request_return", { p_dispensing: uid(form, "dispensing_id", back), p_qty: int(form, "qty", back, "Quantity"), p_reason: str(form, "reason"), p_saleable: form.get("saleable") === "on" });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", "Return recorded. A second person must review it before stock changes.");
}
export async function decideReturn(form: FormData): Promise<void> {
  await requireRole("pharmacist", "admin");
  const back = "/pharmacy/stock";
  const accept = str(form, "decision") === "accept";
  const { data, error } = await (await createClient()).rpc("decide_return", { p_return: uid(form, "return_id", back), p_accept: accept, p_note: str(form, "note") || undefined });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", accept ? (data === "restocked" ? "Return accepted and put back in stock." : "Return accepted and disposed (not safe to resell).") : "Return rejected.");
}
export async function addMedicine(form: FormData): Promise<void> {
  await requireRole("pharmacist", "admin");
  const back = "/pharmacy/stock";
  const { error } = await (await createClient()).rpc("add_medicine", { p_name: str(form, "name"), p_strength: str(form, "strength"), p_form: str(form, "form") || "tablet", p_controlled: form.get("controlled") === "on" });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", "Medicine added.");
}
export async function receiveStock(form: FormData): Promise<void> {
  await requireRole("pharmacist", "admin");
  const back = "/pharmacy/stock";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(form, "expiry"))) go(back, "error", "Enter the expiry date.");
  const { error } = await (await createClient()).rpc("receive_stock", { p_medicine: uid(form, "medicine_id", back), p_batch: str(form, "batch_no"), p_expiry: str(form, "expiry"), p_qty: int(form, "qty", back, "Quantity"), p_supplier: str(form, "supplier") });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", "Stock received.");
}
export async function setBatchStatus(form: FormData): Promise<void> {
  await requireRole("pharmacist", "admin");
  const back = "/pharmacy/stock";
  const { data, error } = await (await createClient()).rpc("set_batch_status", { p_batch: uid(form, "batch_id", back), p_status: str(form, "status"), p_reason: str(form, "reason") });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", str(form, "status") === "recalled" ? `Batch recalled. ${data} prescriber${data === 1 ? "" : "s"} notified.` : "Batch status updated.");
}
export async function disposeBatch(form: FormData): Promise<void> {
  await requireRole("pharmacist", "admin");
  const back = "/pharmacy/stock";
  const { error } = await (await createClient()).rpc("dispose_batch", { p_batch: uid(form, "batch_id", back), p_reason: str(form, "reason") });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", "Batch disposed and stock removed.");
}
export async function prescribe(form: FormData): Promise<void> {
  await requireRole("doctor");
  const back = `/prescribe?patient=${str(form, "patient_id")}`;
  const { error } = await (await createClient()).rpc("prescribe", {
    p_patient: uid(form, "patient_id", "/prescribe"), p_medicine: uid(form, "medicine_id", back), p_dose: str(form, "dose"), p_route: str(form, "route"),
    p_frequency: str(form, "frequency"), p_days: int(form, "days", back, "Days", 365), p_qty: int(form, "qty", back, "Quantity"),
  });
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", "Prescription sent to pharmacy.");
}
