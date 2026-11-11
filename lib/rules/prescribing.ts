/**
 * Prescription input validation. Pure.
 *
 * NOT included, on purpose: dose-range checking, renal/age adjustment and
 * interaction checking. Those need a clinician-reviewed formulary; a guess
 * here would look authoritative and be wrong. Only structural checks live here.
 */

export const ROUTES = [
  "oral",
  "topical",
  "inhaled",
  "intravenous",
  "intramuscular",
  "subcutaneous",
  "rectal",
  "ophthalmic",
  "other",
] as const;
export type Route = (typeof ROUTES)[number];

export const FREQUENCIES = [
  "once daily",
  "twice daily",
  "three times daily",
  "four times daily",
  "every 8 hours",
  "every 12 hours",
  "as needed",
  "once only",
  "weekly",
] as const;

export interface PrescriptionInput {
  drugName: string;
  dose: string;
  route: string;
  frequency: string;
  durationDays: string | number | null | undefined;
}

export type PrescriptionErrors = Partial<Record<keyof PrescriptionInput, string>>;

export function validatePrescription(input: PrescriptionInput): PrescriptionErrors {
  const e: PrescriptionErrors = {};
  const drug = input.drugName.trim();
  if (!drug) e.drugName = "Enter the medicine.";
  else if (drug.length > 200) e.drugName = "Keep the medicine name under 200 characters.";

  const dose = input.dose.trim();
  if (!dose) e.dose = "Enter the dose, e.g. 500 mg.";
  else if (!/\d/.test(dose)) e.dose = "Include an amount, e.g. 500 mg or 2 puffs.";
  else if (dose.length > 100) e.dose = "Keep the dose under 100 characters.";

  if (!(ROUTES as readonly string[]).includes(input.route)) e.route = "Choose a route.";
  if (!input.frequency.trim()) e.frequency = "Choose how often.";
  else if (input.frequency.length > 100) e.frequency = "Keep this under 100 characters.";

  const raw = typeof input.durationDays === "number" ? String(input.durationDays) : (input.durationDays ?? "").trim();
  if (raw !== "") {
    if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 365) e.durationDays = "Enter 1 to 365 days, or leave blank for ongoing.";
  }
  return e;
}

export function parseDuration(raw: string | null | undefined): number | null {
  const t = raw?.trim() ?? "";
  return t === "" ? null : Number(t);
}
