import "server-only";
import type { AllergyRecord } from "@/lib/rules/allergy";
import type { ReferenceRange, ResultFlag } from "@/lib/rules/lab-flags";
import type { LabOrderStatus } from "@/lib/rules/lab-orders";
import type { ServerClient } from "@/lib/supabase/server";

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export async function getAllergies(supabase: ServerClient, patientId: string): Promise<AllergyRecord[]> {
  const { data, error } = await supabase
    .from("patient_allergies")
    .select("id, kind, allergen, allergen_class, severity, reaction, removed_at")
    .eq("patient_id", patientId)
    .is("removed_at", null)
    .order("recorded_at");
  if (error) throw new Error(error.message);
  return data.map((a) => ({
    id: a.id,
    kind: a.kind as AllergyRecord["kind"],
    allergen: a.allergen,
    allergenClass: a.allergen_class,
    severity: a.severity,
    reaction: a.reaction,
    removed: false,
  }));
}

export async function getPrescriptionsForPatient(supabase: ServerClient, patientId: string) {
  const { data, error } = await supabase
    .from("prescriptions")
    .select("id, drug_name, dose, route, frequency, duration_days, status, allergy_check_status, allergy_override_reason, created_at, prescriber_id")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return data;
}

export interface LabResultView {
  id: string;
  testName: string;
  testCode: string;
  value: number | null;
  unit: string;
  flag: ResultFlag | null;
  refLow: number | null;
  refHigh: number | null;
  rangeReviewed: boolean | null;
  comment: string | null;
  enteredAt: string | null;
  acknowledgedAt: string | null;
  releasedAt: string | null;
}

export interface LabOrderView {
  id: string;
  status: LabOrderStatus;
  orderedAt: string;
  orderedById: string;
  orderedByName: string;
  patientId: string;
  patientName: string;
  consultationId: string | null;
  clinicalNotes: string | null;
  cancelledReason: string | null;
  results: LabResultView[];
}

const ORDER_SELECT = `id, status, ordered_at, ordered_by, patient_id, consultation_id, clinical_notes, cancelled_reason,
  orderer:profiles!lab_orders_ordered_by_clinic_id_fkey(full_name),
  patient:patients!lab_orders_patient_id_clinic_id_fkey(given_name, family_name),
  results:lab_results(id, value, unit, flag, ref_low, ref_high, range_reviewed, comment, entered_at, acknowledged_at, released_at,
    test:lab_test_types!lab_results_test_type_id_clinic_id_fkey(name, code))`;

function toView(o: {
  id: string; status: string; ordered_at: string; ordered_by: string; patient_id: string; consultation_id: string | null;
  clinical_notes: string | null; cancelled_reason: string | null;
  orderer: { full_name: string } | null; patient: { given_name: string; family_name: string } | null;
  results: Array<{
    id: string; value: number | null; unit: string; flag: string | null; ref_low: number | null; ref_high: number | null;
    range_reviewed: boolean | null; comment: string | null; entered_at: string | null; acknowledged_at: string | null;
    released_at: string | null; test: { name: string; code: string } | null;
  }>;
}): LabOrderView {
  return {
    id: o.id,
    status: o.status as LabOrderStatus,
    orderedAt: o.ordered_at,
    orderedById: o.ordered_by,
    orderedByName: o.orderer?.full_name ?? "",
    patientId: o.patient_id,
    patientName: o.patient ? `${o.patient.given_name} ${o.patient.family_name}` : "Unknown patient",
    consultationId: o.consultation_id,
    clinicalNotes: o.clinical_notes,
    cancelledReason: o.cancelled_reason,
    results: o.results
      .map((r) => ({
        id: r.id,
        testName: r.test?.name ?? "Test",
        testCode: r.test?.code ?? "",
        value: num(r.value),
        unit: r.unit,
        flag: r.flag as ResultFlag | null,
        refLow: num(r.ref_low),
        refHigh: num(r.ref_high),
        rangeReviewed: r.range_reviewed,
        comment: r.comment,
        enteredAt: r.entered_at,
        acknowledgedAt: r.acknowledged_at,
        releasedAt: r.released_at,
      }))
      .sort((a, b) => a.testName.localeCompare(b.testName)),
  };
}
export async function getLabOrdersForPatient(supabase: ServerClient, patientId: string): Promise<LabOrderView[]> {
  const { data, error } = await supabase.from("lab_orders").select(ORDER_SELECT).eq("patient_id", patientId).order("ordered_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return data.map(toView);
}

export async function getLabOrder(supabase: ServerClient, id: string): Promise<LabOrderView | null> {
  const { data, error } = await supabase.from("lab_orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toView(data) : null;
}

/** The laboratory's queue: orders still waiting for results, oldest first. */
export async function getOpenLabOrders(supabase: ServerClient): Promise<LabOrderView[]> {
  const { data, error } = await supabase.from("lab_orders").select(ORDER_SELECT).in("status", ["ordered", "collected"]).order("ordered_at").limit(100);
  if (error) throw new Error(error.message);
  return data.map(toView);
}

export async function getRecentlyResulted(supabase: ServerClient): Promise<LabOrderView[]> {
  const { data, error } = await supabase.from("lab_orders").select(ORDER_SELECT).eq("status", "resulted").order("updated_at", { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  return data.map(toView);
}

export async function getActiveTests(supabase: ServerClient) {
  const { data, error } = await supabase.from("lab_test_types").select("id, code, name, unit").eq("active", true).order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function getRangesByTest(supabase: ServerClient) {
  const { data, error } = await supabase
    .from("lab_reference_ranges")
    .select("id, test_type_id, sex, age_min_years, age_max_years, low, high, critical_low, critical_high, reviewed_at, reviewed_by_name, note")
    .order("age_min_years");
  if (error) throw new Error(error.message);
  const map = new Map<string, Array<ReferenceRange & { note: string | null; reviewedBy: string | null }>>();
  for (const r of data) {
    const list = map.get(r.test_type_id) ?? [];
    list.push({
      id: r.id, sex: r.sex as ReferenceRange["sex"], ageMinYears: r.age_min_years, ageMaxYears: r.age_max_years,
      low: num(r.low), high: num(r.high), criticalLow: num(r.critical_low), criticalHigh: num(r.critical_high),
      reviewed: r.reviewed_at !== null, note: r.note, reviewedBy: r.reviewed_by_name,
    });
    map.set(r.test_type_id, list);
  }
  return map;
}
