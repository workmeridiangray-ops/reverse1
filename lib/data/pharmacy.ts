import "server-only";
import type { StockBatch } from "@/lib/rules/dispensing";
import type { ServerClient } from "@/lib/supabase/server";

export interface ProductView {
  id: string;
  name: string;
  unit: string;
  drugClasses: string[];
  reorderLevel: number;
  active: boolean;
  batches: Array<StockBatch & { supplier: string | null; statusNote: string | null; received: number }>;
}

/** Products with their batches. Dates arrive as clinic-neutral YYYY-MM-DD strings. */
export async function getStock(supabase: ServerClient): Promise<ProductView[]> {
  const [products, batches] = await Promise.all([
    supabase.from("stock_products").select("id, name, unit, drug_classes, reorder_level, active").order("name"),
    supabase.from("stock_batches").select("id, product_id, batch_number, expiry_date, quantity_on_hand, quantity_received, status, status_note, supplier").order("expiry_date"),
  ]);
  if (products.error) throw new Error(products.error.message);
  if (batches.error) throw new Error(batches.error.message);
  return products.data.map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    drugClasses: p.drug_classes,
    reorderLevel: p.reorder_level,
    active: p.active,
    batches: batches.data
      .filter((b) => b.product_id === p.id)
      .map((b) => ({
        id: b.id,
        batchNumber: b.batch_number,
        expiryDate: b.expiry_date,
        onHand: b.quantity_on_hand,
        status: b.status as StockBatch["status"],
        supplier: b.supplier,
        statusNote: b.status_note,
        received: b.quantity_received,
      })),
  }));
}

export async function getDispensingQueue(supabase: ServerClient) {
  const { data, error } = await supabase
    .from("prescriptions")
    .select(
      `id, drug_name, dose, route, frequency, duration_days, drug_classes, allergy_check_status, allergy_override_reason, created_at,
       patient:patients!prescriptions_patient_id_clinic_id_fkey(id, given_name, family_name, mrn)`,
    )
    .eq("status", "active")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export async function getPrescriptionToDispense(supabase: ServerClient, id: string) {
  const { data, error } = await supabase
    .from("prescriptions")
    .select(
      `id, status, drug_name, dose, route, frequency, duration_days, drug_classes, allergy_check_status, allergy_override_reason, patient_id,
       patient:patients!prescriptions_patient_id_clinic_id_fkey(id, given_name, family_name, mrn, date_of_birth)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getRecentDispenses(supabase: ServerClient) {
  const { data, error } = await supabase
    .from("dispenses")
    .select(
      `id, quantity, dispensed_at, mid_course, fefo_skipped, allergy_flagged, pharmacist_note,
       product:stock_products!dispenses_product_id_clinic_id_fkey(name),
       patient:patients!dispenses_patient_id_clinic_id_fkey(given_name, family_name, mrn)`,
    )
    .order("dispensed_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return data;
}

/** Everyone who received stock from a batch: the recall trace. */
export async function getBatchTrace(supabase: ServerClient, batchId: string) {
  const { data, error } = await supabase
    .from("dispense_items")
    .select(
      `id, quantity,
       dispense:dispenses!dispense_items_dispense_id_clinic_id_fkey(dispensed_at, patient_id,
         patient:patients!dispenses_patient_id_clinic_id_fkey(given_name, family_name, mrn),
         pharmacist:profiles!dispenses_dispensed_by_clinic_id_fkey(full_name))`,
    )
    .eq("batch_id", batchId);
  if (error) throw new Error(error.message);
  return data.sort((a, b) => (b.dispense?.dispensed_at ?? "").localeCompare(a.dispense?.dispensed_at ?? ""));
}
