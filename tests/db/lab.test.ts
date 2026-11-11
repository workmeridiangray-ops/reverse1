/**
 * Laboratory rules against real Supabase Postgres: who may do what, the
 * database-computed flag, critical acknowledgement, release-to-patient.
 */
import { afterAll, describe, expect, it } from "vitest";
import { act, as, attempt, CLINIC_A, CLINIC_B, ID, pool, scenario, U, type Q } from "./helpers";

afterAll(() => pool.end());

interface Res { flag: string | null; value: number | null; range_reviewed: boolean | null; acknowledged_at: Date | null; released_at: Date | null; unit: string }
const result = async (q: Q, id: string) =>
  (await q<Res>(`select flag, value, range_reviewed, acknowledged_at, released_at, unit from public.lab_results where id = $1`, [id]))[0]!;

/** Doctor orders one test; the lab enters the value; returns the flag. */
async function orderAndEnter(q: Q, patient: string, test: string, value: number, doctor: "doctorA" = "doctorA") {
  await act(q, doctor);
  const [o] = await q<{ id: string }>(`select public.create_lab_order($1, null, $2::uuid[], null) as id`, [patient, [test]]);
  await act(q, "labA");
  const [r] = await q<{ id: string }>(`update public.lab_results set value = $2 where order_id = $1 returning id`, [o!.id, value]);
  return { orderId: o!.id, resultId: r!.id, ...(await result(q, r!.id)) };
}

describe("ordering", () => {
  it("a doctor orders tests; results are created waiting, with the unit from the catalogue", async () => {
    await as("doctorA", async (q) => {
      const [o] = await q<{ id: string }>(`select public.create_lab_order($1, $2, $3::uuid[], 'Fatigue') as id`, [ID.amal, ID.consultSigned, [ID.typeHb, ID.typeFerr, ID.typeHb]]);
      const rows = await q<{ unit: string; value: number | null; flag: string | null }>(`select unit, value, flag from public.lab_results where order_id = $1 order by unit`, [o!.id]);
      expect(rows).toEqual([{ unit: "g/dL", value: null, flag: null }, { unit: "ug/L", value: null, flag: null }]); // duplicate test collapsed
      const [ord] = await q<{ status: string; ordered_by: string }>(`select status, ordered_by from public.lab_orders where id = $1`, [o!.id]);
      expect(ord).toEqual({ status: "ordered", ordered_by: U.doctorA });
    });
  });

  it("refuses an empty order, another clinic's test, an inactive test and a mismatched consultation", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.create_lab_order($1, null, '{}'::uuid[])`, [ID.amal])).error).toMatch(/at least one test/);
      expect((await attempt(q, `select public.create_lab_order($1, null, $2::uuid[])`, [ID.amal, [ID.typeHbB]])).error).toMatch(/not available/);
      expect((await attempt(q, `select public.create_lab_order($1, $2, $3::uuid[])`, [ID.george, ID.consultSigned, [ID.typeHb]])).error).toMatch(/consultation's patient/);
    });
    await scenario(async (q) => {
      await q(`update public.lab_test_types set active = false where id = $1`, [ID.typeHb]);
      await act(q, "doctorA");
      expect((await attempt(q, `select public.create_lab_order($1, null, $2::uuid[])`, [ID.amal, [ID.typeHb]])).error).toMatch(/not available/);
    });
  });

  it("a doctor cannot order for another clinic's patient", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.create_lab_order($1, null, $2::uuid[])`, [ID.jon, [ID.typeHb]])).ok).toBe(false);
    });
  });

  it.each(["deskA", "adminA", "labA", "pharmA", "patientA"] as const)("%s cannot order tests", async (u) => {
    await as(u, async (q) => {
      expect((await attempt(q, `select public.create_lab_order($1, null, $2::uuid[])`, [ID.amal, [ID.typeHb]])).ok).toBe(false);
    });
  });
});

describe("entering results: the database decides the flag", () => {
  it("13 g/dL haemoglobin is normal for a woman and low for a man", async () => {
    await scenario(async (q) => {
      expect((await orderAndEnter(q, ID.amal, ID.typeHb, 13)).flag).toBe("normal"); // female 12.0-15.5
      expect((await orderAndEnter(q, ID.ravi, ID.typeHb, 13)).flag).toBe("low"); // male 13.5-17.5
    });
  });

  it("no range on file means no flag, never a guess (a child, and an adult with no sex-specific range)", async () => {
    await scenario(async (q) => {
      expect((await orderAndEnter(q, ID.sofia, ID.typeHb, 13)).flag).toBe("unflagged"); // age 11: adult ranges only
      await q(`reset role`);
      const [p] = await q<{ id: string }>(
        `insert into public.patients (clinic_id, given_name, family_name, date_of_birth, sex_at_birth) values ($1, 'Sam', 'Unknown', '1990-01-01', 'unknown') returning id`, [CLINIC_A]);
      expect((await orderAndEnter(q, p!.id, ID.typeHb, 13)).flag).toBe("unflagged"); // unknown sex, only sex-specific ranges
      expect((await orderAndEnter(q, p!.id, ID.typeK, 4.0)).flag).toBe("normal"); // potassium has an any-sex range
    });
  });

  it("critical values and the stored range snapshot", async () => {
    const r = await as("doctorA", (q) => result(q, ID.resKRavi));
    expect(r).toMatchObject({ flag: "critical_high", value: 6.8, unit: "mmol/L", acknowledged_at: null });
    // The seeded ranges are unreviewed placeholders, and the result says so.
    expect(r.range_reviewed).toBe(false);
  });

  it("the client cannot supply the flag or tamper with computed fields", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      const [o] = await q<{ id: string }>(`select public.create_lab_order($1, null, $2::uuid[], null) as id`, [ID.ravi, [ID.typeHb]]);
      await act(q, "labA");
      for (const set of [`value = 5, flag = 'normal'`, `value = 5, unit = 'mg'`, `value = 5, released_at = now()`, `value = 5, acknowledged_at = now()`, `value = 5, ref_low = 0`]) {
        expect((await attempt(q, `update public.lab_results set ${set} where order_id = $1`, [o!.id])).error, set).toMatch(/cannot change those fields|identity cannot be changed/);
      }
    });
  });

  it("doctors cannot enter values (the laboratory does)", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `update public.lab_results set value = 4 where id = $1`, [ID.resGluGeorge])).error).toMatch(/cannot change those fields/);
    });
    await scenario(async (q) => {
      await act(q, "doctorA");
      const [o] = await q<{ id: string }>(`select public.create_lab_order($1, null, $2::uuid[], null) as id`, [ID.ravi, [ID.typeHb]]);
      expect((await attempt(q, `insert into public.lab_results (clinic_id, order_id, patient_id, test_type_id, unit, value) values ($1, $2, $3, $4, 'x', 5)`,
        [CLINIC_A, o!.id, ID.ravi, ID.typeK])).error).toMatch(/entered by the laboratory|duplicate|unique/);
    });
  });

  it("values must be non-negative numbers; the lab cannot clear a result", async () => {
    await as("labA", async (q) => {
      expect((await attempt(q, `update public.lab_results set value = -1 where id = $1`, [ID.resGluGeorge])).ok).toBe(false);
      expect((await attempt(q, `update public.lab_results set value = null where id = $1`, [ID.resKRavi])).error).toMatch(/cannot be cleared/);
    });
  });

  it("entering the last value results the order automatically", async () => {
    await as("labA", async (q) => {
      const before = await q<{ status: string }>(`select status from public.lab_orders where id = $1`, [ID.orderGeorge]);
      expect(before[0]?.status).toBe("collected");
      await q(`update public.lab_results set value = 4.6 where id = $1`, [ID.resGluGeorge]);
      const [after] = await q<{ status: string; collected_at: Date }>(`select status, collected_at from public.lab_orders where id = $1`, [ID.orderGeorge]);
      expect(after?.status).toBe("resulted");
      expect(after?.collected_at).toBeInstanceOf(Date);
    });
  });

  it("correcting a value recomputes the flag and clears the acknowledgement", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(`update public.lab_results set acknowledged_at = now() where id = $1`, [ID.resKRavi]);
      expect((await result(q, ID.resKRavi)).acknowledged_at).toBeInstanceOf(Date);
      await act(q, "labA");
      await q(`update public.lab_results set value = 4.2 where id = $1`, [ID.resKRavi]);
      expect(await result(q, ID.resKRavi)).toMatchObject({ flag: "normal", value: 4.2, acknowledged_at: null });
    });
  });

  it("the lab cannot enter results on a cancelled order, or change released results", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(`update public.lab_orders set status = 'cancelled', cancelled_reason = 'Ordered in error' where id = $1`, [ID.orderGeorge]);
      await act(q, "labA");
      expect((await attempt(q, `update public.lab_results set value = 5 where id = $1`, [ID.resGluGeorge])).error).toMatch(/cancelled/);
      expect((await attempt(q, `update public.lab_results set value = 5 where id = $1`, [ID.resHbAmal])).error).toMatch(/Released results cannot be changed/);
    });
  });

  it.each(["deskA", "adminA", "pharmA", "patientA"] as const)("%s cannot enter results", async (u) => {
    await as(u, async (q) => {
      expect((await attempt(q, `update public.lab_results set value = 5 where id = $1 returning id`, [ID.resGluGeorge])).rows).toBe(0);
    });
  });
});

describe("critical results", () => {
  it("only the ordering doctor can acknowledge, and the stamp is server-side", async () => {
    await as("doctorA2", async (q) => {
      expect((await attempt(q, `update public.lab_results set acknowledged_at = now() where id = $1 returning id`, [ID.resKRavi])).rows).toBe(0);
    });
    await as("labA", async (q) => {
      expect((await attempt(q, `update public.lab_results set acknowledged_at = now() where id = $1`, [ID.resKRavi])).error).toMatch(/cannot change those fields/);
    });
    await as("doctorA", async (q) => {
      await q(`update public.lab_results set acknowledged_at = '2001-01-01', acknowledged_by = $2 where id = $1`, [ID.resKRavi, U.doctorA2]);
      const [r] = await q<{ acknowledged_by: string; acknowledged_at: Date }>(`select acknowledged_by, acknowledged_at from public.lab_results where id = $1`, [ID.resKRavi]);
      expect(r?.acknowledged_by).toBe(U.doctorA); // not the forged doctor
      expect(r?.acknowledged_at.getFullYear()).toBeGreaterThan(2020); // not the forged date
    });
  });

  it("an acknowledgement cannot be taken back", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(`update public.lab_results set acknowledged_at = now() where id = $1`, [ID.resKRavi]);
      await q(`update public.lab_results set acknowledged_at = null where id = $1`, [ID.resKRavi]);
      expect((await result(q, ID.resKRavi)).acknowledged_at).toBeInstanceOf(Date);
    });
  });
});

describe("release to the patient", () => {
  it("results appear to the patient only after the ordering doctor releases them", async () => {
    await scenario(async (q) => {
      await act(q, "patientA");
      expect(await q(`select id from public.lab_results where id = $1`, [ID.resFerrAmal])).toHaveLength(0);
      await act(q, "doctorA");
      expect((await attempt(q, `update public.lab_results set released_at = now() where id = $1 returning id`, [ID.resFerrAmal])).rows).toBe(1);
      await act(q, "patientA");
      const [r] = await q<{ value: number; flag: string }>(`select value, flag from public.lab_results where id = $1`, [ID.resFerrAmal]);
      expect(r).toEqual({ value: 9, flag: "low" });
    });
  });

  it("a patient never sees someone else's released results, nor another clinic's", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(`update public.lab_results set released_at = now() where id = $1`, [ID.resKRavi]);
      await act(q, "patientA");
      expect(await q(`select id from public.lab_results where id = $1`, [ID.resKRavi])).toHaveLength(0);
      expect(await q(`select id from public.lab_results where id = $1`, [ID.resHbJon])).toHaveLength(0);
    });
  });

  it("only the ordering doctor releases, and nothing without a value", async () => {
    await as("doctorA2", async (q) => {
      expect((await attempt(q, `update public.lab_results set released_at = now() where id = $1 returning id`, [ID.resFerrAmal])).rows).toBe(0);
    });
    await as("labA", async (q) => {
      expect((await attempt(q, `update public.lab_results set released_at = now() where id = $1`, [ID.resFerrAmal])).error).toMatch(/cannot change those fields/);
    });
    await as("doctorA", async (q) => {
      expect((await attempt(q, `update public.lab_results set released_at = now() where id = $1`, [ID.resGluGeorge])).error).toMatch(/no result to release|check constraint/);
    });
  });

  it("a release cannot be withdrawn by the doctor, and the stamp is server-side", async () => {
    await as("doctorA", async (q) => {
      await q(`update public.lab_results set released_at = null where id = $1`, [ID.resHbAmal]);
      expect((await result(q, ID.resHbAmal)).released_at).toBeInstanceOf(Date);
    });
  });

  it("the patient can read the name of the test they were sent, and no catalogue beyond it", async () => {
    await as("patientA", async (q) => {
      const rows = await q<{ code: string }>(`select code from public.lab_test_types`);
      expect(rows).toEqual([{ code: "HB" }]);
    });
  });
});

describe("order lifecycle", () => {
  it("the lab collects a sample; doctors cannot; reception cannot see orders", async () => {
    await as("labA", async (q) => {
      const r = await attempt(q, `update public.lab_orders set status = 'collected' where id = $1 returning id`, [ID.orderGeorge]);
      expect(r.ok).toBe(true); // already collected: same-state no-op is allowed
    });
    await as("doctorA", async (q) => {
      expect((await attempt(q, `update public.lab_orders set status = 'collected' where id = $1`, [ID.orderGeorge])).ok).toBe(true); // same state
      expect((await attempt(q, `update public.lab_orders set clinical_notes = 'changed' where id = $1`, [ID.orderGeorge])).error).toMatch(/cannot be changed/);
    });
    await as("deskA", async (q) => {
      expect(await q(`select id from public.lab_orders`)).toHaveLength(0);
    });
  });

  it("a doctor cancels their own order with a reason, only before any result", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `update public.lab_orders set status = 'cancelled' where id = $1`, [ID.orderGeorge])).ok).toBe(false); // reason required (check)
      expect((await attempt(q, `update public.lab_orders set status = 'cancelled', cancelled_reason = 'Duplicate' where id = $1`, [ID.orderGeorge])).ok).toBe(true);
      expect((await attempt(q, `update public.lab_orders set status = 'cancelled', cancelled_reason = 'Oops' where id = $1`, [ID.orderAmal])).error).toMatch(/Cannot change a lab order from resulted|cannot be cancelled/);
    });
    await as("labA", async (q) => {
      expect((await attempt(q, `update public.lab_orders set status = 'cancelled', cancelled_reason = 'No' where id = $1`, [ID.orderGeorge])).error).toMatch(/can only collect or result/);
    });
    await as("doctorA2", async (q) => {
      expect((await attempt(q, `update public.lab_orders set status = 'cancelled', cancelled_reason = 'Mine now' where id = $1 returning id`, [ID.orderGeorge])).rows).toBe(0);
    });
  });
});

describe("catalogue and reference ranges (admin-managed)", () => {
  const range = `insert into public.lab_reference_ranges (clinic_id, test_type_id, sex, age_min_years, age_max_years, low, high) values ($1, $2, $3, $4, $5, $6, $7)`;
  it("an admin adds tests and ranges; nobody else can", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `insert into public.lab_test_types (clinic_id, code, name, unit) values ($1, 'NA', 'Sodium', 'mmol/L')`, [CLINIC_A])).ok).toBe(true);
      expect((await attempt(q, range, [CLINIC_A, ID.typeHb, "female", 0, 18, 11, 14])).ok).toBe(true); // children, adjacent to 18+
    });
    for (const u of ["doctorA", "labA", "deskA", "pharmA", "patientA"] as const) {
      await as(u, async (q) => {
        expect((await attempt(q, `insert into public.lab_test_types (clinic_id, code, name, unit) values ($1, 'NA', 'Sodium', 'mmol/L')`, [CLINIC_A])).error, u).toMatch(/row-level security/);
        expect((await attempt(q, `update public.lab_reference_ranges set high = 99 returning id`)).rows, u).toBe(0);
      });
    }
  });
  it("overlapping ranges for the same test and sex are impossible", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, range, [CLINIC_A, ID.typeHb, "female", 17, 30, 11, 14])).error).toMatch(/lab_ranges_no_overlap/);
      expect((await attempt(q, range, [CLINIC_A, ID.typeHb, "female", 0, 18, 11, 14])).ok).toBe(true);
      expect((await attempt(q, range, [CLINIC_A, ID.typeHb, "female", 0, 5, 11, 14])).error).toMatch(/lab_ranges_no_overlap/);
    });
  });
  it("nonsense ranges are rejected", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, range, [CLINIC_A, ID.typeGlu, "male", 0, 18, 6, 4])).error).toMatch(/check constraint/); // low >= high
      expect((await attempt(q, range, [CLINIC_A, ID.typeGlu, "male", 20, 10, 4, 6])).error).toMatch(/check constraint/); // age max <= min
      expect((await attempt(q, `insert into public.lab_reference_ranges (clinic_id, test_type_id, sex, low, high, critical_low) values ($1, $2, 'male', 4, 6, 5)`, [CLINIC_A, ID.typeGlu])).error).toMatch(/check constraint/);
      expect((await attempt(q, `insert into public.lab_reference_ranges (clinic_id, test_type_id, sex) values ($1, $2, 'male')`, [CLINIC_A, ID.typeGlu])).error).toMatch(/check constraint/); // no limits at all
    });
  });
  it("an admin cannot touch another clinic's catalogue or point a range at it", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, range, [CLINIC_A, ID.typeHbB, "any", 0, 5, 1, 2])).error).toMatch(/foreign key/);
      expect((await attempt(q, `update public.lab_test_types set name = 'x' where id = $1 returning id`, [ID.typeHbB])).rows).toBe(0);
    });
  });
});

describe("audit", () => {
  it("records result entry and release with field names only, never values", async () => {
    await scenario(async (q) => {
      await act(q, "labA");
      await q(`update public.lab_results set value = 7.7 where id = $1`, [ID.resGluGeorge]);
      await act(q, "doctorA");
      await q(`update public.lab_results set released_at = now() where id = $1`, [ID.resGluGeorge]);
      await act(q, null);
      const rows = await q<{ actor_role: string; changed_fields: string[]; s: string }>(
        `select actor_role, changed_fields, a::text as s from public.audit_log a where table_name = 'lab_results' and record_id = $1 and action = 'update' order by id`, [ID.resGluGeorge]);
      expect(rows.map((r) => r.actor_role)).toEqual(["lab", "doctor"]);
      expect(rows[0]?.changed_fields).toEqual(expect.arrayContaining(["value", "flag", "entered_at"]));
      expect(rows[1]?.changed_fields).toEqual(expect.arrayContaining(["released_at", "released_by"]));
      for (const r of rows) expect(r.s).not.toContain("7.7");
    });
  });
  it("logs a doctor opening a lab order, and refuses for roles that cannot see it", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(`select public.log_record_access('lab_orders', $1, 'reviewing')`, [ID.orderAmal]);
      await act(q, null);
      const [row] = await q<{ actor_id: string; patient_id: string }>(`select actor_id, patient_id from public.audit_log where action = 'view' and table_name = 'lab_orders'`);
      expect(row).toEqual({ actor_id: U.doctorA, patient_id: ID.amal });
      await act(q, "deskA");
      expect((await attempt(q, `select public.log_record_access('lab_orders', $1)`, [ID.orderAmal])).error).toMatch(/not found/);
    });
  });
});

describe("clinic isolation", () => {
  it("clinic B's doctor and lab-facing data never mix with clinic A", async () => {
    await as("doctorB", async (q) => {
      const ids = await q<{ id: string }>(`select id from public.lab_results`);
      expect(ids.map((i) => i.id)).toEqual([ID.resHbJon]);
      expect((await attempt(q, `update public.lab_results set released_at = now() where id = $1 returning id`, [ID.resKRavi])).rows).toBe(0);
      expect((await attempt(q, `select public.create_lab_order($1, null, $2::uuid[])`, [ID.amal, [ID.typeHbB]])).ok).toBe(false);
    });
    expect(CLINIC_B).toBeTruthy();
  });
});

describe("a date of birth in the future", () => {
  it("is never given an infant range: no flag", async () => {
    await scenario(async (q) => {
      const [p] = await q<{ id: string }>(
        `insert into public.patients (clinic_id, given_name, family_name, date_of_birth, sex_at_birth) values ($1, 'Not', 'Yet', current_date + 30, 'female') returning id`, [CLINIC_A]);
      // Potassium has an any-age range, so only the negative age keeps it from matching.
      expect((await orderAndEnter(q, p!.id, ID.typeK, 4.0)).flag).toBe("unflagged");
    });
  });
});
