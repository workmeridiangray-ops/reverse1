"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { getInvoice } from "@/lib/data/billing";
import { type InsuranceStatus, validateInsurance, validatePayment } from "@/lib/rules/invoice";
import { lineTotal, MoneyError, parseMajor } from "@/lib/rules/money";
import { createClient } from "@/lib/supabase/server";

const INSURANCE: readonly InsuranceStatus[] = ["none", "pending", "settled", "denied"];
const METHODS = ["cash", "card", "bank_transfer", "other"] as const;

function back(id: string, params: Record<string, string>): never {
  revalidatePath(`/billing/${id}`);
  redirect(`/billing/${id}?${new URLSearchParams(params)}`);
}

export async function createInvoice(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist");
  const patientId = String(form.get("patient_id") ?? "");
  const appointmentId = String(form.get("appointment_id") ?? "") || null;
  if (!patientId) redirect("/billing/new?error=" + encodeURIComponent("Choose a patient."));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    // number is assigned by a database trigger; "" only satisfies the type.
    .insert({ clinic_id: session.clinic.id, patient_id: patientId, appointment_id: appointmentId, currency: session.clinic.currency, number: "" })
    .select("id")
    .single();
  if (error) redirect("/billing/new?error=" + encodeURIComponent(friendlyDbError(error.message)));
  revalidatePath("/billing");
  redirect(`/billing/${data.id}`);
}

export async function addLine(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist");
  const id = String(form.get("invoice_id") ?? "");
  const description = String(form.get("description") ?? "").trim();
  const quantity = Number(String(form.get("quantity") ?? "1"));
  let unit: number;
  try {
    unit = parseMajor(String(form.get("unit_price") ?? ""), session.clinic.currency);
    lineTotal(quantity, unit); // validates quantity, sign and integer-ness
  } catch (e) {
    back(id, { error: e instanceof MoneyError ? e.message : "Check the quantity and price." });
  }
  if (!description) back(id, { error: "Describe the item." });
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoice_lines")
    .insert({ clinic_id: session.clinic.id, invoice_id: id, description, quantity, unit_price_minor: unit });
  if (error) back(id, { error: friendlyDbError(error.message) });
  back(id, {});
}

export async function removeLine(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const id = String(form.get("invoice_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_lines").delete().eq("id", String(form.get("line_id") ?? "")).eq("invoice_id", id);
  if (error) back(id, { error: friendlyDbError(error.message) });
  back(id, {});
}

export async function issueInvoice(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const id = String(form.get("invoice_id") ?? "");
  const supabase = await createClient();
  const inv = await getInvoice(supabase, id);
  if (!inv) back(id, { error: "Invoice not found." });
  if (inv.lines.length === 0) back(id, { error: "Add at least one item before issuing." });
  const { error } = await supabase.from("invoices").update({ state: "issued" }).eq("id", id);
  if (error) back(id, { error: friendlyDbError(error.message) });
  back(id, { ok: "Invoice issued. Items are now locked." });
}

export async function voidInvoice(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const id = String(form.get("invoice_id") ?? "");
  const reason = String(form.get("void_reason") ?? "").trim();
  if (!reason) back(id, { error: "Give a reason for voiding." });
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update({ state: "void", void_reason: reason }).eq("id", id);
  if (error) back(id, { error: friendlyDbError(error.message) });
  back(id, { ok: "Invoice voided." });
}

export async function updateInsurance(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist");
  const id = String(form.get("invoice_id") ?? "");
  const status = String(form.get("insurance_status") ?? "") as InsuranceStatus;
  if (!INSURANCE.includes(status)) back(id, { error: "Choose an insurance status." });
  const supabase = await createClient();
  const inv = await getInvoice(supabase, id);
  if (!inv) back(id, { error: "Invoice not found." });
  let claimed = 0;
  let paid = 0;
  try {
    if (status !== "none") claimed = parseMajor(String(form.get("claimed") || "0"), session.clinic.currency);
    if (status === "settled") paid = parseMajor(String(form.get("insurer_paid") || "0"), session.clinic.currency);
  } catch (e) {
    back(id, { error: e instanceof MoneyError ? e.message : "Check the amounts." });
  }
  const issues = status === "none" ? [] : validateInsurance(inv.balance.totalMinor, claimed, paid);
  if (status !== "none" && claimed === 0) issues.push("Enter the amount claimed from the insurer.");
  if (issues.length) back(id, { error: issues.join(" ") });
  const { error } = await supabase
    .from("invoices")
    .update({ insurance_status: status, insurer_name: String(form.get("insurer_name") ?? "").trim() || null, insurance_claimed_minor: claimed, insurance_paid_minor: paid })
    .eq("id", id);
  if (error) back(id, { error: friendlyDbError(error.message) });
  back(id, { ok: "Insurance updated." });
}

export async function recordPayment(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist");
  const id = String(form.get("invoice_id") ?? "");
  const method = String(form.get("method") ?? "");
  if (!(METHODS as readonly string[]).includes(method)) back(id, { error: "Choose how they paid." });
  let amount = 0;
  try {
    amount = parseMajor(String(form.get("amount") ?? ""), session.clinic.currency);
  } catch (e) {
    back(id, { error: e instanceof MoneyError ? e.message : "Check the amount." });
  }
  const supabase = await createClient();
  const inv = await getInvoice(supabase, id);
  if (!inv) back(id, { error: "Invoice not found." });
  const issues = validatePayment(inv.balance, amount);
  if (issues.length) back(id, { error: issues.join(" ") });
  const { error } = await supabase.from("payments").insert({
    clinic_id: session.clinic.id,
    invoice_id: id,
    amount_minor: amount,
    method: method as (typeof METHODS)[number],
    reference: String(form.get("reference") ?? "").trim() || null,
  });
  if (error) back(id, { error: friendlyDbError(error.message) });
  revalidatePath("/reception");
  back(id, { ok: "Payment recorded." });
}
