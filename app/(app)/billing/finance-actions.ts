"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { parseMajor } from "@/lib/rules/money";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function go(path: string, kind: "ok" | "error", message: string): never {
  revalidatePath(path);
  revalidatePath("/billing");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${new URLSearchParams({ [kind]: message })}`);
}
function id(f: FormData, k: string, back: string): string {
  const v = str(f, k);
  if (!UUID.test(v)) go(back, "error", "That link is not valid. Reload the page and try again.");
  return v;
}
function money(f: FormData, k: string, back: string, currency: string, allowZero = false): number {
  let minor: number;
  try {
    minor = parseMajor(str(f, k), currency);
  } catch {
    return go(back, "error", "Enter a valid amount with at most two decimals, e.g. 125.50.");
  }
  if (minor < 0 || (minor === 0 && !allowZero)) go(back, "error", "Enter an amount greater than zero.");
  return minor;
}

export async function captureCharge(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const back = `/admissions/${id(form, "admission_id", "/admissions")}`;
  const qty = Number.parseInt(str(form, "quantity"), 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10000) go(back, "error", "Enter a whole quantity of 1 or more.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("capture_charge", { p_patient: id(form, "patient_id", back), p_admission: id(form, "admission_id", back), p_code: str(form, "code"), p_qty: qty });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", "Charge added.");
}

export async function addBedDays(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const adm = id(form, "admission_id", "/admissions");
  const back = `/admissions/${adm}`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("capture_bed_days", { p_admission: adm });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", data ? `${data} bed-day${data > 1 ? "s" : ""} added.` : "Bed-days are already up to date.");
}

export async function cancelCharge(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const back = `/admissions/${id(form, "admission_id", "/admissions")}`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_charge", { p_charge: id(form, "charge_id", back), p_reason: str(form, "reason") });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", "Charge cancelled.");
}

export async function generateBill(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const back = `/admissions/${id(form, "admission_id", "/admissions")}`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_bill", { p_patient: id(form, "patient_id", back), p_admission: id(form, "admission_id", back) });
  if (error) go(back, "error", friendlyDbError(error.message));
  redirect(`/billing/${data}?${new URLSearchParams({ ok: "Draft bill created from the charges. Review it, then issue it." })}`);
}

export async function recordDeposit(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist");
  const back = `/admissions/${id(form, "admission_id", "/admissions")}`;
  const method = str(form, "method");
  if (!["cash", "card", "bank_transfer", "other"].includes(method)) go(back, "error", "Choose how the deposit was paid.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_deposit", {
    p_patient: id(form, "patient_id", back), p_admission: id(form, "admission_id", back), p_amount: money(form, "amount", back, session.clinic.currency),
    p_method: method as "cash", p_reference: str(form, "reference"),
  });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", "Deposit recorded.");
}

export async function applyDeposit(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const inv = id(form, "invoice_id", "/billing");
  const back = `/billing/${inv}`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_deposit", { p_deposit: id(form, "deposit_id", back), p_invoice: inv });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", `Deposit applied (${(Number(data) / 100).toFixed(2)}).`);
}

export async function requestRefund(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist");
  const inv = str(form, "invoice_id");
  const dep = str(form, "deposit_id");
  const back = inv ? `/billing/${inv}` : "/billing/refunds";
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_refund", {
    p_invoice: (inv || undefined) as string, p_deposit: (dep || undefined) as string, p_amount: money(form, "amount", back, session.clinic.currency), p_reason: str(form, "reason"),
  });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", "Refund requested. A second person must approve it before money moves.");
}

export async function decideRefund(form: FormData): Promise<void> {
  await requireRole("admin");
  const back = "/billing/refunds";
  const approve = str(form, "decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_refund", { p_refund: id(form, "refund_id", back), p_approve: approve, p_reason: str(form, "reason") || undefined });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", approve ? "Refund approved." : "Refund rejected.");
}

export async function createTariff(form: FormData): Promise<void> {
  await requireRole("admin");
  const back = "/billing/tariffs";
  const date = str(form, "effective_from");
  if (!str(form, "name") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) go(back, "error", "Give the tariff a name and an effective date.");
  const copy = str(form, "copy_from");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_tariff_draft", { p_name: str(form, "name"), p_effective: date, p_copy_from: (UUID.test(copy) ? copy : undefined) as string });
  if (error) go(back, "error", friendlyDbError(error.message));
  go(back, "ok", "Draft tariff created. Add or change prices, then activate it.");
}

export async function saveTariffItem(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const back = "/billing/tariffs";
  const version = id(form, "version_id", back);
  const itemId = str(form, "id");
  const price = { minor: money(form, "price", back, session.clinic.currency, true) };
  const row = { code: str(form, "code").toUpperCase(), description: str(form, "description"), category: str(form, "category") || "service", unit_price_minor: price.minor };
  const supabase = await createClient();
  const { error } = itemId
    ? await supabase.from("tariff_items").update(row).eq("id", itemId)
    : await supabase.from("tariff_items").insert({ ...row, clinic_id: session.clinic.id, version_id: version });
  if (error) go(back, "error", /tariff_items_version_id_code_key/.test(error.message) ? "That code already exists in this tariff." : /check constraint/.test(error.message) ? "Codes use capitals, digits, - and _ (max 20). Check the description and category too." : friendlyDbError(error.message));
  go(back, "ok", itemId ? "Price updated." : "Price added.");
}

export async function deleteTariffItem(form: FormData): Promise<void> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("tariff_items").delete().eq("id", id(form, "id", "/billing/tariffs"));
  if (error) go("/billing/tariffs", "error", friendlyDbError(error.message));
  go("/billing/tariffs", "ok", "Price removed.");
}

export async function activateTariff(form: FormData): Promise<void> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_tariff", { p_version: id(form, "version_id", "/billing/tariffs") });
  if (error) go("/billing/tariffs", "error", friendlyDbError(error.message));
  go("/billing/tariffs", "ok", "Tariff activated. New charges use these prices; existing charges keep theirs.");
}
