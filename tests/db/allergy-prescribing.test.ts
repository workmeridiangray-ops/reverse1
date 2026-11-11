/**
 * Allergies and allergy-checked prescribing, against real Supabase Postgres.
 * The database enforces the same warn-and-justify rule as lib/rules/allergy.ts,
 * so it holds even if a client skips the check.
 */
import { afterAll, describe, expect, it } from "vitest";
import { act, as, attempt, CLINIC_A, CLINIC_B, ID, pool, scenario, U } from "./helpers";

afterAll(() => pool.end());

const addAllergy = `insert into public.patient_allergies (clinic_id, patient_id, kind, allergen, allergen_class, severity, reaction)
                    values ($1, $2, 'allergy', 'Sulfa drugs', 'sulfonamide', 'mild', 'Rash') returning id`;
const rx = (classes: string[], reason: string | null, patient: string = ID.amal, drug = "Amoxicillin") => [
  `insert into public.prescriptions (clinic_id, patient_id, prescriber_id, drug_name, dose, route, frequency, drug_classes, allergy_override_reason, status)
   values ($1, $2, $3, $4, '500 mg', 'oral', 'three times daily', $5, $6, 'active') returning allergy_check_status`,
  [CLINIC_A, patient, U.doctorA, drug, classes, reason],
] as const;

describe("recording allergies", () => {
  it("a doctor records an allergy", async () => {
    await as("doctorA", async (q) => {
      expect(await attempt(q, addAllergy, [CLINIC_A, ID.ravi])).toMatchObject({ ok: true, rows: 1 });
      const [row] = await q<{ recorded_by: string }>(`select recorded_by from public.patient_allergies where patient_id = $1`, [ID.ravi]);
      expect(row?.recorded_by).toBe(U.doctorA);
    });
  });

  it("recording an allergy supersedes an earlier 'no known allergies' entry", async () => {
    await as("doctorA", async (q) => {
      await q(addAllergy, [CLINIC_A, ID.george]);
      const [nkda] = await q<{ removed_at: Date | null; removed_reason: string }>(
        `select removed_at, removed_reason from public.patient_allergies where id = $1`, [ID.nkdaGeorge]);
      expect(nkda?.removed_at).toBeInstanceOf(Date);
      expect(nkda?.removed_reason).toBe("Allergy recorded");
    });
  });

  it("cannot confirm 'no known allergies' while allergies are recorded", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(q, `insert into public.patient_allergies (clinic_id, patient_id, kind) values ($1, $2, 'nkda')`, [CLINIC_A, ID.amal]);
      expect(r.error).toMatch(/Remove the recorded allergies/);
    });
  });

  it("only one live 'no known allergies' entry per patient", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(q, `insert into public.patient_allergies (clinic_id, patient_id, kind) values ($1, $2, 'nkda')`, [CLINIC_A, ID.george]);
      expect(r.error).toMatch(/patient_allergies_one_nkda|duplicate/);
    });
  });

  it("entries are never edited: remove with a reason, then add a new one", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `update public.patient_allergies set severity = 'mild' where id = $1`, [ID.allergyAmal])).error).toMatch(/cannot be edited/);
      expect((await attempt(q, `update public.patient_allergies set removed_at = now() where id = $1`, [ID.allergyAmal])).error).toMatch(/check constraint|removed_reason/);
      expect((await attempt(q, `update public.patient_allergies set removed_at = now(), removed_reason = 'Entered in error' where id = $1`, [ID.allergyAmal])).ok).toBe(true);
      expect((await attempt(q, `update public.patient_allergies set removed_reason = 'changed my mind' where id = $1`, [ID.allergyAmal])).error).toMatch(/Removed entries cannot be changed/);
    });
  });

  it.each(["deskA", "adminA", "labA", "pharmA", "patientA"] as const)("%s cannot record allergies", async (u) => {
    await as(u, async (q) => {
      expect((await attempt(q, addAllergy, [CLINIC_A, ID.ravi])).error).toMatch(/row-level security/);
    });
  });

  it("a doctor cannot record an allergy for another clinic's patient", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, addAllergy, [CLINIC_A, ID.jon])).error).toMatch(/foreign key/);
      expect((await attempt(q, addAllergy, [CLINIC_B, ID.jon])).error).toMatch(/row-level security/);
    });
  });
});

describe("prescribing against a recorded allergy (class match, enforced by the database)", () => {
  it("amoxicillin for a penicillin-allergic patient needs a written reason", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, ...rx(["penicillin"], null))).error).toMatch(/Allergy conflict/);
      expect((await attempt(q, ...rx(["penicillin"], "   "))).error).toMatch(/Allergy conflict/);
      expect((await attempt(q, ...rx(["penicillin"], "too short"))).error).toMatch(/Allergy conflict/); // 9 characters
    });
  });

  it("...but a real reason lets it through: warn and justify, never block", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(q, ...rx(["penicillin"], "Culture-proven strep; no alternative; counselled and monitored."));
      expect(r).toMatchObject({ ok: true, rows: 1 });
      const [row] = await q<{ allergy_check_status: string; allergy_override_reason: string }>(
        `select allergy_check_status, allergy_override_reason from public.prescriptions where drug_name = 'Amoxicillin' and patient_id = $1`, [ID.amal]);
      expect(row).toMatchObject({ allergy_check_status: "overridden" });
      expect(row?.allergy_override_reason).toContain("counselled");
    });
  });

  it("exactly 10 characters is enough; 9 is not", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, ...rx(["penicillin"], "123456789"))).ok).toBe(false);
      expect((await attempt(q, ...rx(["penicillin"], "1234567890"))).ok).toBe(true);
    });
  });

  it("stores an honest status for every other situation", async () => {
    await as("doctorA", async (q) => {
      const status = async (classes: string[], patient: string) => (await q<{ allergy_check_status: string }>(...rx(classes, null, patient)))[0]?.allergy_check_status;
      expect(await status(["paracetamol"], ID.amal)).toBe("clear"); // allergies recorded, none match
      expect(await status(["penicillin"], ID.george)).toBe("clear"); // confirmed no known allergies
      expect(await status(["paracetamol"], ID.ravi)).toBe("no_allergy_record"); // nothing recorded is NOT 'clear'
      expect(await status([], ID.amal)).toBe("unchecked"); // drug the catalog does not know
    });
  });

  it("a client cannot claim the check was clear", async () => {
    await as("doctorA", async (q) => {
      const [row] = await q<{ allergy_check_status: string }>(
        `insert into public.prescriptions (clinic_id, patient_id, prescriber_id, drug_name, dose, route, frequency, drug_classes, allergy_check_status)
         values ($1, $2, $3, 'Zorblax', '1 tab', 'oral', 'daily', '{}', 'clear') returning allergy_check_status`, [CLINIC_A, ID.amal, U.doctorA]);
      expect(row?.allergy_check_status).toBe("unchecked");
    });
  });

  it("the stored status cannot be edited afterwards", async () => {
    await as("doctorA", async (q) => {
      const [before] = await q<{ allergy_check_status: string }>(`select allergy_check_status from public.prescriptions where id = $1`, [ID.rxActive]);
      await q(`update public.prescriptions set allergy_check_status = 'overridden', dose = '250 mg' where id = $1`, [ID.rxActive]);
      const [row] = await q<{ allergy_check_status: string; dose: string }>(`select allergy_check_status, dose from public.prescriptions where id = $1`, [ID.rxActive]);
      expect(row?.dose).toBe("250 mg"); // the real edit went through
      expect(row?.allergy_check_status).toBe(before?.allergy_check_status); // the forged status did not
    });
  });

  it("changing the drug class re-runs the check on an existing prescription", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(q, `update public.prescriptions set drug_classes = '{penicillin}' where id = $1`, [ID.rxActive]);
      expect(r.error).toMatch(/Allergy conflict/);
    });
  });

  it("an allergy recorded LATER does not block the pharmacist from dispensing", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(...rx(["penicillin"], null, ID.ravi)); // Ravi: no allergies recorded yet
      await q(addAllergy.replace("'Sulfa drugs', 'sulfonamide'", "'Penicillin', 'penicillin'"), [CLINIC_A, ID.ravi]);
      await act(q, "pharmA");
      const r = await attempt(q, `update public.prescriptions set status = 'dispensed' where patient_id = $1 and drug_name = 'Amoxicillin' returning id`, [ID.ravi]);
      expect(r).toMatchObject({ ok: true, rows: 1 });
    });
  });

  it("the pharmacist can see the override reason; reception cannot see prescriptions at all", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(...rx(["penicillin"], "Allergy clinic advised graded challenge."));
      await act(q, "pharmA");
      const rows = await q<{ allergy_override_reason: string }>(`select allergy_override_reason from public.prescriptions where allergy_check_status = 'overridden'`);
      expect(rows[0]?.allergy_override_reason).toContain("graded challenge");
      await act(q, "deskA");
      expect(await q(`select id from public.prescriptions`)).toHaveLength(0);
    });
  });
});
