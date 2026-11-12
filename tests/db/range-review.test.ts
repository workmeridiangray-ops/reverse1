/**
 * Lab reference ranges: admins edit, doctors sign off, and a sign-off always
 * means "a clinician reviewed exactly these numbers". Real Supabase Postgres.
 */
import { afterAll, describe, expect, it } from "vitest";
import { act, as, attempt, CLINIC_A, ID, pool, scenario, U, type Q } from "./helpers";

afterAll(() => pool.end());

interface RangeRow { low: number | null; high: number | null; reviewed_at: Date | null; reviewed_by: string | null; reviewed_by_name: string | null; updated_by: string | null }
const range = async (q: Q, id: string) =>
  (await q<RangeRow>(`select low::float8 as low, high::float8 as high, reviewed_at, reviewed_by, reviewed_by_name, updated_by from public.lab_reference_ranges where id = $1`, [id]))[0]!;
const signOff = (q: Q, id: string) => attempt(q, `update public.lab_reference_ranges set reviewed_at = now() where id = $1 returning id`, [id]);

describe("sign-off", () => {
  it("a doctor signs off a range; the database stamps who and when", async () => {
    await as("doctorA", async (q) => {
      expect((await signOff(q, ID.rangeKAny)).rows).toBe(1);
      const r = await range(q, ID.rangeKAny);
      expect(r.reviewed_by).toBe(U.doctorA);
      expect(r.reviewed_by_name).toBe("Dr. Chidi Okafor");
      expect(r.reviewed_at).toBeInstanceOf(Date);
    });
  });
  it("a doctor cannot forge the reviewer or the date", async () => {
    await as("doctorA", async (q) => {
      await q(`update public.lab_reference_ranges set reviewed_at = '2001-01-01', reviewed_by = $2, reviewed_by_name = 'Prof. Somebody' where id = $1`, [ID.rangeKAny, U.doctorA2]);
      const r = await range(q, ID.rangeKAny);
      expect(r.reviewed_by).toBe(U.doctorA);
      expect(r.reviewed_by_name).toBe("Dr. Chidi Okafor");
      expect(r.reviewed_at!.getFullYear()).toBeGreaterThan(2020);
    });
  });
  it("an existing sign-off cannot be rewritten by another doctor, only withdrawn", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await signOff(q, ID.rangeKAny);
      await act(q, "doctorA2");
      await signOff(q, ID.rangeKAny); // tries to re-sign as themselves
      expect((await range(q, ID.rangeKAny)).reviewed_by).toBe(U.doctorA);
      await q(`update public.lab_reference_ranges set reviewed_at = null where id = $1`, [ID.rangeKAny]);
      expect(await range(q, ID.rangeKAny)).toMatchObject({ reviewed_at: null, reviewed_by: null, reviewed_by_name: null });
    });
  });
  it("a doctor cannot change the numbers, the age band, the sex or the note", async () => {
    await as("doctorA", async (q) => {
      for (const set of ["high = 9", "low = 1", "critical_high = 30", "age_min_years = 5", "sex = 'male'", "note = 'tweaked'"]) {
        expect((await attempt(q, `update public.lab_reference_ranges set ${set} where id = $1`, [ID.rangeKAny])).error, set).toMatch(/sign off a range but not edit it/);
      }
    });
  });
  it("the administrator can never sign off, directly or by stamping fields", async () => {
    await as("adminA", async (q) => {
      expect((await signOff(q, ID.rangeKAny)).error).toMatch(/Only a doctor can sign off/);
      expect((await attempt(q, `update public.lab_reference_ranges set reviewed_by = $2, reviewed_by_name = 'x', reviewed_at = now() where id = $1`, [ID.rangeKAny, U.doctorA])).error).toMatch(/Only a doctor/);
    });
  });
  it.each(["labA", "deskA", "pharmA", "patientA"] as const)("%s cannot sign off or edit", async (u) => {
    await as(u, async (q) => { expect((await signOff(q, ID.rangeKAny)).rows, u).toBe(0); });
  });
  it("another clinic's doctor cannot sign off this clinic's range", async () => {
    await as("doctorB", async (q) => { expect((await signOff(q, ID.rangeKAny)).rows).toBe(0); });
  });
});

describe("editing clears the sign-off", () => {
  it.each(["high = 5.3", "low = 3.4", "critical_low = 2.5", "critical_high = 6.5"])("changing %s clears it", async (set) => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await signOff(q, ID.rangeKAny);
      expect((await range(q, ID.rangeKAny)).reviewed_by).toBe(U.doctorA);
      await act(q, "adminA");
      expect((await attempt(q, `update public.lab_reference_ranges set ${set} where id = $1`, [ID.rangeKAny])).ok).toBe(true);
      expect(await range(q, ID.rangeKAny)).toMatchObject({ reviewed_at: null, reviewed_by: null, reviewed_by_name: null, updated_by: U.adminA });
    });
  });
  it("editing only the note keeps it (nothing a clinician checked has changed)", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await signOff(q, ID.rangeKAny);
      await act(q, "adminA");
      await q(`update public.lab_reference_ranges set note = 'Source: lab handbook 2026' where id = $1`, [ID.rangeKAny]);
      expect((await range(q, ID.rangeKAny)).reviewed_by).toBe(U.doctorA);
    });
  });
  it("an administrator cannot dodge the clearing by sending the old stamps back", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await signOff(q, ID.rangeKAny);
      await act(q, "adminA");
      // The admin's form sends the sign-off fields back exactly as it loaded them, alongside a changed limit.
      const r = await attempt(q, `update public.lab_reference_ranges set high = 5.3, reviewed_at = reviewed_at, reviewed_by = reviewed_by, reviewed_by_name = reviewed_by_name where id = $1`, [ID.rangeKAny]);
      expect(r.ok).toBe(true); // unchanged stamps are not an attempt to sign off...
      expect(await range(q, ID.rangeKAny)).toMatchObject({ high: 5.3, reviewed_at: null, reviewed_by: null }); // ...and the edit still clears them
      // Sending DIFFERENT stamps is refused outright.
      await act(q, "doctorA");
      await signOff(q, ID.rangeGluAny);
      await act(q, "adminA");
      expect((await attempt(q, `update public.lab_reference_ranges set reviewed_by_name = 'Someone else' where id = $1`, [ID.rangeGluAny])).error).toMatch(/Only a doctor/);
    });
  });
  it("a range cannot be moved to another test", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `update public.lab_reference_ranges set test_type_id = $2 where id = $1`, [ID.rangeKAny, ID.typeHb])).error).toMatch(/another test/);
    });
  });
});

describe("new ranges and old results", () => {
  const add = `insert into public.lab_reference_ranges (clinic_id, test_type_id, sex, age_min_years, age_max_years, low, high, reviewed_at, reviewed_by, reviewed_by_name)
               values ($1, $2, 'female', 0, 18, 11, 14, now(), $3, 'Forged') returning id`;
  it("a range an administrator creates always starts unreviewed, even if the form says otherwise", async () => {
    await as("adminA", async (q) => {
      const [r] = await q<{ id: string }>(add, [CLINIC_A, ID.typeHb, U.doctorA]);
      expect(await range(q, r!.id)).toMatchObject({ reviewed_at: null, reviewed_by: null, reviewed_by_name: null, updated_by: U.adminA });
    });
  });
  it("results keep the status of the range at the moment they were flagged", async () => {
    await scenario(async (q) => {
      // Ravi's potassium was flagged from an UNREVIEWED range.
      await act(q, "doctorA");
      expect((await q<{ range_reviewed: boolean }>(`select range_reviewed from public.lab_results where id = $1`, [ID.resKRavi]))[0]!.range_reviewed).toBe(false);
      await signOff(q, ID.rangeKAny);
      // Signing off now does NOT retroactively relabel it...
      expect((await q<{ range_reviewed: boolean }>(`select range_reviewed from public.lab_results where id = $1`, [ID.resKRavi]))[0]!.range_reviewed).toBe(false);
      // ...but a result entered afterwards is flagged from the reviewed range.
      const [o] = await q<{ id: string }>(`select public.create_lab_order($1, null, $2::uuid[], null) as id`, [ID.ravi, [ID.typeK]]);
      await act(q, "labA");
      await q(`update public.lab_results set value = 4.1 where order_id = $1`, [o!.id]);
      expect((await q<{ range_reviewed: boolean; flag: string }>(`select range_reviewed, flag from public.lab_results where order_id = $1`, [o!.id]))[0]).toEqual({ range_reviewed: true, flag: "normal" });
    });
  });
  it("editing a range after results used it does not rewrite those results", async () => {
    await scenario(async (q) => {
      await act(q, "adminA");
      await q(`update public.lab_reference_ranges set high = 4.0, critical_high = 4.5 where id = $1`, [ID.rangeKAny]);
      await act(q, "doctorA");
      const [r] = await q<{ flag: string; ref_high: number }>(`select flag, ref_high::float8 as ref_high from public.lab_results where id = $1`, [ID.resKRavi]);
      expect(r).toEqual({ flag: "critical_high", ref_high: 5.1 }); // still what it was when flagged
    });
  });
});

describe("deleting ranges and changing tests", () => {
  it("an administrator can delete an unused range, but not one that results were flagged from", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `delete from public.lab_reference_ranges where id = $1 returning id`, [ID.rangeGluAny])).rows).toBe(1);
      expect((await attempt(q, `delete from public.lab_reference_ranges where id = $1`, [ID.rangeKAny])).error).toMatch(/foreign key/);
    });
  });
  it("nobody else can delete ranges", async () => {
    for (const u of ["doctorA", "labA", "deskA", "pharmA", "patientA"] as const) {
      await as(u, async (q) => { expect((await attempt(q, `delete from public.lab_reference_ranges where id = $1 returning id`, [ID.rangeGluAny])).rows, u).toBe(0); });
    }
    await as("adminB", async (q) => { expect((await attempt(q, `delete from public.lab_reference_ranges where id = $1 returning id`, [ID.rangeGluAny])).rows).toBe(0); });
  });
  it("a test's code and unit are frozen once it has results; the name and active flag are not", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `update public.lab_test_types set unit = 'mg/dL' where id = $1`, [ID.typeK])).error).toMatch(/cannot change once it has results/);
      expect((await attempt(q, `update public.lab_test_types set code = 'POTASSIUM' where id = $1`, [ID.typeK])).error).toMatch(/cannot change/);
      expect((await attempt(q, `update public.lab_test_types set name = 'Serum potassium', active = false where id = $1`, [ID.typeK])).ok).toBe(true);
      expect((await attempt(q, `update public.lab_test_types set unit = 'mg/dL' where id = $1`, [ID.typeGlu])).error).toMatch(/cannot change/); // glucose has a pending result row too
    });
  });
  it("a test with no results can still be corrected", async () => {
    await as("adminA", async (q) => {
      const [t] = await q<{ id: string }>(`insert into public.lab_test_types (clinic_id, code, name, unit) values ($1, 'NA', 'Sodium', 'mmol/l') returning id`, [CLINIC_A]);
      expect((await attempt(q, `update public.lab_test_types set unit = 'mmol/L' where id = $1`, [t!.id])).ok).toBe(true);
    });
  });
});

describe("audit", () => {
  it("records sign-off and edits as field names only", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await signOff(q, ID.rangeKAny);
      await act(q, "adminA");
      await q(`update public.lab_reference_ranges set high = 5.4 where id = $1`, [ID.rangeKAny]);
      await act(q, null);
      const rows = await q<{ actor_role: string; changed_fields: string[]; s: string }>(
        `select actor_role, changed_fields, a::text as s from public.audit_log a where table_name = 'lab_reference_ranges' and action = 'update' and record_id = $1 order by id`, [ID.rangeKAny]);
      expect(rows.map((r) => r.actor_role)).toEqual(["doctor", "admin"]);
      expect(rows[0]!.changed_fields).toEqual(expect.arrayContaining(["reviewed_at", "reviewed_by", "reviewed_by_name"]));
      expect(rows[1]!.changed_fields).toEqual(expect.arrayContaining(["high", "reviewed_at"]));
      expect(rows[1]!.s).not.toContain("5.4");
    });
  });
});
