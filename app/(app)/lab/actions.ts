"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function go(path: string, kind: "ok" | "error", message: string): never {
  revalidatePath(path); revalidatePath("/lab"); revalidatePath("/investigations");
  redirect(`${path}?${new URLSearchParams({ [kind]: message })}`);
}
function oid(f: FormData, base: string): string {
  const v = str(f, "order_id");
  if (!UUID.test(v)) go(base, "error", "That link is not valid. Reload and try again.");
  return v;
}

export async function collectSpecimen(form: FormData): Promise<void> {
  await requireRole("lab", "admin");
  const id = oid(form, "/lab");
  const { data, error } = await (await createClient()).rpc("collect_specimen", { p_order: id });
  if (error) go(`/lab/orders/${id}`, "error", friendlyDbError(error.message));
  go(`/lab/orders/${id}`, "ok", `Collected. Accession ${data}.`);
}

export async function enterResult(form: FormData): Promise<void> {
  await requireRole("lab", "admin");
  const id = oid(form, "/lab");
  const flag = str(form, "flag") || "normal";
  if (!["normal", "abnormal", "critical"].includes(flag)) go(`/lab/orders/${id}`, "error", "Choose a flag.");
  if (!str(form, "value")) go(`/lab/orders/${id}`, "error", "Enter the result.");
  const { error } = await (await createClient()).rpc("enter_result", {
    p_order: id, p_value: str(form, "value"), p_unit: str(form, "unit"), p_range: str(form, "reference_range"), p_flag: flag,
    p_note: str(form, "note"), p_amend_reason: str(form, "amend_reason") || undefined,
  });
  if (error) go(`/lab/orders/${id}`, "error", /check constraint/.test(error.message) ? "A value is too long or empty. Check the fields." : friendlyDbError(error.message));
  go(`/lab/orders/${id}`, "ok", "Result saved. It is not visible to clinicians until someone else reviews and publishes it.");
}

export async function publishResult(form: FormData): Promise<void> {
  await requireRole("lab", "admin");
  const id = oid(form, "/lab");
  const { error } = await (await createClient()).rpc("publish_result", { p_order: id });
  if (error) go(`/lab/orders/${id}`, "error", friendlyDbError(error.message));
  go(`/lab/orders/${id}`, "ok", "Reviewed and published. The ordering doctor has been notified.");
}

export async function placeOrder(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  await requireRole("doctor");
  const patient = str(form, "patient_id");
  if (!UUID.test(patient)) return { error: "Choose a patient." };
  if (!str(form, "test_name")) return { error: "Say which test or scan is needed." };
  const adm = str(form, "admission_id");
  const { data, error } = await (await createClient()).rpc("place_order", {
    p_patient: patient, p_admission: (UUID.test(adm) ? adm : null) as string, p_test: str(form, "test_name"),
    p_kind: str(form, "kind") === "imaging" ? "imaging" : "lab", p_priority: str(form, "priority") === "urgent" ? "urgent" : "routine", p_note: str(form, "clinical_note"),
  });
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath("/investigations");
  redirect(`/investigations/${data}?ok=${encodeURIComponent("Order placed.")}`);
}

export async function cancelOrder(form: FormData): Promise<void> {
  await requireRole("doctor", "lab", "admin");
  const id = oid(form, "/investigations");
  const { error } = await (await createClient()).rpc("cancel_order", { p_order: id, p_reason: str(form, "reason") });
  if (error) go(`/investigations/${id}`, "error", friendlyDbError(error.message));
  go(`/investigations/${id}`, "ok", "Order cancelled.");
}

export async function acknowledgeCritical(form: FormData): Promise<void> {
  await requireRole("doctor");
  const id = oid(form, "/investigations");
  const { error } = await (await createClient()).rpc("acknowledge_critical", { p_order: id });
  if (error) go(`/investigations/${id}`, "error", friendlyDbError(error.message));
  go(`/investigations/${id}`, "ok", "Critical result acknowledged.");
}

export async function markNotificationsRead(): Promise<void> {
  await requireRole("admin", "doctor", "receptionist", "nurse", "lab", "pharmacist", "patient");
  await (await createClient()).rpc("mark_notifications_read");
  revalidatePath("/notifications");
  redirect("/notifications");
}
