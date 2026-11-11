/**
 * Parity: lib/rules/allergy.ts vs app.prescription_allergy_rules().
 * For every drug x patient below, the TypeScript check and the database must
 * agree on (a) whether a written reason is required and (b) the stored status.
 */
import { afterAll, describe, expect, it } from "vitest";
import { type AllergyRecord, checkAllergies, storedAllergyStatus } from "@/lib/rules/allergy";
import { asOwner, attempt, CLINIC_A, ID, pool, U } from "./helpers";

afterAll(() => pool.end());

const DRUGS = [
  "Amoxicillin 500 mg", "co-amoxiclav", "Flucloxacillin", "Phenoxymethylpenicillin", "Cefalexin", "Ceftriaxone", "Azithromycin",
  "Ibuprofen 400mg", "Aspirin 75 mg", "Naproxen", "Diclofenac", "Paracetamol", "Codeine", "Tramadol", "Co-trimoxazole",
  "Ferrous sulfate", "Omeprazole", "Atorvastatin", "Ramipril", "Metformin", "Salbutamol inhaler",
  "Ibuprofen + paracetamol", "Amoxicillin and ibuprofen", "Zorblax (not in catalogue)", "", "AMOXICILLIN",
];
// Amal: penicillin allergy. Owen: NSAID allergy. George: confirmed none. Ravi: nothing recorded. Sofia: nothing recorded.
const PATIENTS = [ID.amal, ID.owen, ID.george, ID.ravi, ID.sofia];
const REASONS: Array<string | null> = [null, "no", "A sufficiently long written reason."];

describe("allergy check: TypeScript vs database", () => {
  it(`agrees on ${DRUGS.length} drugs x ${PATIENTS.length} patients x ${REASONS.length} reasons`, async () => {
    await asOwner(async (q) => {
      let checked = 0;
      for (const patient of PATIENTS) {
        const rows = await q<{ id: string; kind: "allergy" | "nkda"; allergen: string | null; allergen_class: string | null; severity: AllergyRecord["severity"]; reaction: string | null; removed_at: Date | null }>(
          `select id, kind, allergen, allergen_class, severity, reaction, removed_at from public.patient_allergies where patient_id = $1`, [patient]);
        const records: AllergyRecord[] = rows.map((r) => ({
          id: r.id, kind: r.kind, allergen: r.allergen, allergenClass: r.allergen_class, severity: r.severity, reaction: r.reaction, removed: r.removed_at !== null,
        }));
        for (const drug of DRUGS) {
          const check = checkAllergies(drug, records);
          for (const reason of REASONS) {
            const r = await attempt(
              q,
              `insert into public.prescriptions (clinic_id, patient_id, prescriber_id, drug_name, dose, route, frequency, drug_classes, allergy_override_reason)
               values ($1, $2, $3, $4, '1 tab', 'oral', 'daily', $5, $6) returning allergy_check_status`,
              [CLINIC_A, patient, U.doctorA, drug || "x", check.drugClasses, reason],
            );
            const reasonOk = (reason?.trim().length ?? 0) >= 10;
            const dbShouldAccept = !check.hasDirectConflict || reasonOk; // the database enforces direct matches only
            expect(r.ok, `${patient.slice(-2)} / "${drug}" / ${JSON.stringify(reason)}`).toBe(dbShouldAccept);
            checked++;
          }
        }
      }
      expect(checked).toBe(DRUGS.length * PATIENTS.length * REASONS.length);
    });
  });

  it("stored status equals the TypeScript prediction", async () => {
    await asOwner(async (q) => {
      for (const patient of PATIENTS) {
        const rows = await q<{ id: string; kind: "allergy" | "nkda"; allergen: string | null; allergen_class: string | null; severity: AllergyRecord["severity"]; reaction: string | null; removed_at: Date | null }>(
          `select id, kind, allergen, allergen_class, severity, reaction, removed_at from public.patient_allergies where patient_id = $1`, [patient]);
        const records: AllergyRecord[] = rows.map((r) => ({ id: r.id, kind: r.kind, allergen: r.allergen, allergenClass: r.allergen_class, severity: r.severity, reaction: r.reaction, removed: r.removed_at !== null }));
        for (const drug of DRUGS) {
          const check = checkAllergies(drug, records);
          for (const reason of ["A sufficiently long written reason.", null]) {
            if (check.hasDirectConflict && !reason) continue; // refused by the database; covered above
            const [row] = await q<{ allergy_check_status: string }>(
              `insert into public.prescriptions (clinic_id, patient_id, prescriber_id, drug_name, dose, route, frequency, drug_classes, allergy_override_reason)
               values ($1, $2, $3, $4, '1 tab', 'oral', 'daily', $5, $6) returning allergy_check_status`,
              [CLINIC_A, patient, U.doctorA, drug || "x", check.drugClasses, reason]);
            expect(row?.allergy_check_status, `${patient.slice(-2)} / "${drug}" / ${reason ? "reason" : "no reason"}`).toBe(storedAllergyStatus(check, reason));
          }
        }
      }
    });
  });
});
