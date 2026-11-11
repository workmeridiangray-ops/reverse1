"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getAllergies } from "@/lib/data/clinical";
import { friendlyDbError } from "@/lib/data/errors";
import { getStock } from "@/lib/data/pharmacy";
import { checkAllergies } from "@/lib/rules/allergy";
import { isDrugClass } from "@/lib/rules/drug-catalog";
import { flagsFor, noteReasons, validateAllocations, validateNote } from "@/lib/rules/dispensing";
import { createClient } from "@/lib/supabase/server";
import { localDateKey } from "@/lib/rules/time";

export interface DispenseState {
  formError?: string;
}

/**
 * Dispense. The browser already showed the plan and the flags using the same
 * pure rules; here they run again on the server against current stock, and the
 * database function enforces them a third time.
 */
export async function dispense(_prev: DispenseState, form: FormData): Promise<DispenseState> {
  const session = await requireRole("pharmacist");
  const rxId = String(form.get("prescription_id") ?? "");
  const productId = String(form.get("product_id") ?? "");
  const note = String(form.get("note") ?? "");
  const coverRaw = String(form.get("cover_days") ?? "").trim();
  const cover = coverRaw === "" ? null : Number(coverRaw);
  if (cover !== null && (!Number.isInteger(cover) || cover < 1 || cover > 365)) return { formError: "Days of supply must be a whole number from 1 to 365." };

  let allocations: Array<{ batchId: string; quantity: number }>;
  try {
    const raw = JSON.parse(String(form.get("allocations") ?? "[]")) as Array<{ batchId: string; quantity: number }>;
    allocations = raw.map((a) => ({ batchId: String(a.batchId), quantity: Number(a.quantity) }));
  } catch {
    return { formError: "The batch choice could not be read. Reload the page and try again." };
  }

  const supabase = await createClient();
  const stock = await getStock(supabase);
  const product = stock.find((p) => p.id === productId);
  if (!product) return { formError: "Choose a product." };
  const today = localDateKey(new Date(), session.clinic.timezone);

  const issues = validateAllocations(allocations, product.batches, today);
  if (issues.length) return { formError: issues.join(" ") };

  const { data: rx } = await supabase.from("prescriptions").select("patient_id, drug_classes").eq("id", rxId).maybeSingle();
  if (!rx) return { formError: "Prescription not found." };
  const records = await getAllergies(supabase, rx.patient_id);
  const allergy = checkAllergies("", records, [...rx.drug_classes, ...product.drugClasses]);
  const flags = flagsFor(allocations, product.batches, today, cover);
  const noteError = validateNote(noteReasons(flags, allergy.hasDirectConflict), note);
  if (noteError) return { formError: noteError };

  const { error } = await supabase.rpc("dispense_prescription", {
    p_prescription: rxId,
    p_product: productId,
    p_allocations: allocations.map((a) => ({ batch_id: a.batchId, quantity: a.quantity })),
    p_cover_days: cover as number,
    p_note: note.trim(),
  });
  if (error) return { formError: friendlyDbError(error.message) };
  revalidatePath("/pharmacy");
  redirect(`/pharmacy?ok=${encodeURIComponent(`Dispensed ${allocations.reduce((n, a) => n + a.quantity, 0)} × ${product.name}.`)}`);
}

function back(params: Record<string, string>): never {
  revalidatePath("/pharmacy/stock");
  redirect(`/pharmacy/stock?${new URLSearchParams(params)}`);
}

export async function addProduct(form: FormData): Promise<void> {
  const session = await requireRole("pharmacist");
  const name = String(form.get("name") ?? "").trim();
  const cls = String(form.get("drug_class") ?? "");
  const reorder = Number(String(form.get("reorder_level") ?? "0"));
  if (!name) back({ error: "Name the product." });
  if (cls && !isDrugClass(cls)) back({ error: "Choose a drug class from the list." });
  if (!Number.isInteger(reorder) || reorder < 0) back({ error: "Reorder level must be zero or more." });
  const supabase = await createClient();
  const { error } = await supabase.from("stock_products").insert({
    clinic_id: session.clinic.id, name, unit: String(form.get("unit") ?? "").trim() || "unit", drug_classes: cls ? [cls] : [], reorder_level: reorder,
  });
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: `Added ${name}.` });
}

export async function receiveStock(form: FormData): Promise<void> {
  const session = await requireRole("pharmacist");
  const quantity = Number(String(form.get("quantity") ?? ""));
  const expiry = String(form.get("expiry_date") ?? "");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) back({ error: "Quantity must be a whole number of at least 1." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) back({ error: "Enter the expiry date." });
  const supabase = await createClient();
  const { error } = await supabase.from("stock_batches").insert({
    clinic_id: session.clinic.id,
    product_id: String(form.get("product_id") ?? ""),
    batch_number: String(form.get("batch_number") ?? "").trim(),
    expiry_date: expiry,
    quantity_received: quantity,
    supplier: String(form.get("supplier") ?? "").trim() || null,
  });
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: "Stock received." });
}

export async function setBatchStatus(form: FormData): Promise<void> {
  await requireRole("pharmacist");
  const status = String(form.get("status") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!["available", "quarantined", "recalled"].includes(status)) back({ error: "Unknown status." });
  if (status !== "available" && note.length < 3) back({ error: "Say why, so the next person knows." });
  const supabase = await createClient();
  const { error } = await supabase
    .from("stock_batches")
    .update({ status: status as "available" | "quarantined" | "recalled", status_note: status === "available" ? null : note })
    .eq("id", String(form.get("id") ?? ""));
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: status === "available" ? "Batch released from quarantine." : `Batch ${status}.` });
}

export async function writeOff(form: FormData): Promise<void> {
  await requireRole("pharmacist");
  const qty = Number(String(form.get("quantity") ?? ""));
  const note = String(form.get("note") ?? "").trim();
  if (!Number.isInteger(qty) || qty < 1) back({ error: "Enter how many units to write off." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", { p_batch: String(form.get("id") ?? ""), p_delta: -qty, p_reason: "write_off", p_note: note });
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: `Wrote off ${qty}.` });
}

