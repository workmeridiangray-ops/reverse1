/**
 * Parity: lib/rules/lab-flags.ts vs the database functions and triggers that
 * actually set the stored flag. If either side changes alone, these fail.
 */
import { afterAll, describe, expect, it } from "vitest";
import { canTransitionLabOrder, LAB_ORDER_STATUSES } from "@/lib/rules/lab-orders";
import { flagResult, flagValue, pickRange, type LabSex, type ReferenceRange, type RangeSex } from "@/lib/rules/lab-flags";
import { ageInYears } from "@/lib/rules/time";
import { asOwner, CLINIC_A, ID, pool } from "./helpers";

afterAll(() => pool.end());

describe("flag_value: SQL vs TypeScript", () => {
  const values = [0, 2.79, 2.8, 2.81, 3.4, 3.5, 3.51, 5.09, 5.1, 5.11, 6.19, 6.2, 6.21, 100];
  const opt = <T,>(v: T): Array<T | null> => [null, v];
  const combos = opt(3.5).flatMap((low) => opt(5.1).flatMap((high) => opt(2.8).flatMap((cl) => opt(6.2).map((ch) => ({ low, high, cl, ch })))));

  it(`agrees on ${combos.length * values.length} value/limit combinations`, async () => {
    const cases = combos.flatMap((c) => values.map((v) => ({ ...c, v })));
    const rows = await asOwner((q) =>
      q<{ n: number; flag: string }>(
        `select g.n::int as n, app.flag_value(g.v, g.low, g.high, g.cl, g.ch) as flag
           from jsonb_to_recordset($1::jsonb) as g(n int, v numeric, low numeric, high numeric, cl numeric, ch numeric)`,
        [JSON.stringify(cases.map((c, n) => ({ n, ...c })))],
      ),
    );
    expect(rows).toHaveLength(cases.length);
    for (const r of rows) {
      const c = cases[r.n]!;
      const ts = flagValue(c.v, { low: c.low, high: c.high, criticalLow: c.cl, criticalHigh: c.ch });
      expect(r.flag, JSON.stringify(c)).toBe(ts);
    }
  });
});

describe("age_years: SQL vs TypeScript, across birthdays, leap days and time zones", () => {
  it("agrees on every case", async () => {
    const zones = ["Europe/London", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"];
    const dobs = ["2000-02-29", "1990-11-11", "1990-11-12", "1990-11-10", "2008-03-01", "2026-11-11", "1951-12-31", "1900-01-01"];
    const instants = ["2026-02-28T12:00:00Z", "2026-03-01T00:30:00Z", "2026-11-10T23:30:00Z", "2026-11-11T00:30:00Z", "2026-11-11T23:59:00Z", "2028-02-29T12:00:00Z", "2026-12-31T23:30:00Z", "2027-01-01T00:30:00Z"];
    const cases = zones.flatMap((tz) => dobs.flatMap((dob) => instants.map((at) => ({ tz, dob, at }))));
    const rows = await asOwner((q) =>
      q<{ n: number; age: number }>(
        `select g.n::int as n, app.age_years(g.dob::date, g.at::timestamptz, g.tz) as age
           from jsonb_to_recordset($1::jsonb) as g(n int, dob text, at text, tz text)`,
        [JSON.stringify(cases.map((c, n) => ({ n, ...c })))],
      ),
    );
    expect(rows).toHaveLength(cases.length);
    for (const r of rows) {
      const c = cases[r.n]!;
      const ts = ageInYears(c.dob, new Date(c.at), c.tz);
      // A date of birth in the future: both sides must say "negative" (no range applies),
      // even though the exact negative number differs.
      if (ts < 0) expect(r.age, JSON.stringify(c)).toBeLessThan(0);
      else expect(r.age, JSON.stringify(c)).toBe(ts);
    }
  });
});

describe("pick_reference_range: SQL vs TypeScript", () => {
  it("agrees on sex x age, including the any-sex fallback tier", async () => {
    await asOwner(async (q) => {
      const [t] = await q<{ id: string }>(
        `insert into public.lab_test_types (clinic_id, code, name, unit) values ($1, 'PARITY', 'Parity test', 'u') returning id`, [CLINIC_A]);
      const add = (sex: RangeSex, min: number, max: number, low: number, high: number) =>
        q(`insert into public.lab_reference_ranges (clinic_id, test_type_id, sex, age_min_years, age_max_years, low, high) values ($1, $2, $3, $4, $5, $6, $7)`,
          [CLINIC_A, t!.id, sex, min, max, low, high]);
      await add("any", 0, 200, 1, 9); // everyone
      await add("female", 18, 50, 2, 8); // adult women override
      await add("male", 0, 18, 3, 7); // boys override
      await add("male", 65, 200, 4, 6);

      const rows = await q<{ id: string; sex: RangeSex; age_min_years: number; age_max_years: number; low: number; high: number }>(
        `select id, sex, age_min_years, age_max_years, low, high from public.lab_reference_ranges where test_type_id = $1`, [t!.id]);
      const ranges: ReferenceRange[] = rows.map((r) => ({ id: r.id, sex: r.sex, ageMinYears: r.age_min_years, ageMaxYears: r.age_max_years, low: r.low, high: r.high, criticalLow: null, criticalHigh: null, reviewed: false }));
      const sexes: LabSex[] = ["female", "male", "intersex", "unknown"];
      let checked = 0;
      for (const sex of sexes) {
        for (let age = -1; age <= 130; age++) {
          const [db] = await q<{ id: string | null }>(`select app.pick_reference_range($1, $2::public.sex_at_birth, $3) as id`, [t!.id, sex, age]);
          expect(db?.id ?? null, `${sex} ${age}`).toBe(pickRange(ranges, sex, age)?.id ?? null);
          checked++;
        }
      }
      expect(checked).toBe(4 * 132);
    });
  });
});

describe("end to end through the triggers", () => {
  it("the stored flag equals the TypeScript verdict for sex x age x value", async () => {
    await asOwner(async (q) => {
      const rangeRows = await q<{ id: string; sex: RangeSex; age_min_years: number; age_max_years: number; low: number | null; high: number | null; critical_low: number | null; critical_high: number | null }>(
        `select id, sex, age_min_years, age_max_years, low, high, critical_low, critical_high from public.lab_reference_ranges where test_type_id = $1`, [ID.typeHb]);
      const ranges: ReferenceRange[] = rangeRows.map((r) => ({
        id: r.id, sex: r.sex, ageMinYears: r.age_min_years, ageMaxYears: r.age_max_years, low: r.low, high: r.high, criticalLow: r.critical_low, criticalHigh: r.critical_high, reviewed: false,
      }));
      const sexes: LabSex[] = ["female", "male", "intersex", "unknown"];
      // Around the adult cut-off: 17y 364d, exactly 18y, 18y + 1d, plus a child and an adult.
      const ageDays: Array<[number, number]> = [[17, 1], [18, 0], [18, 1], [5, 100], [40, 200], [90, 0]];
      const values = [5, 6.9, 7, 11.9, 12, 13, 13.5, 15.5, 17.6, 20, 21];
      let n = 0;
      for (const sex of sexes) {
        for (const [years, days] of ageDays) {
          const [p] = await q<{ id: string; dob: string; now: Date }>(
            `insert into public.patients (clinic_id, given_name, family_name, date_of_birth, sex_at_birth)
             values ($1, 'P', 'Parity', ((now() at time zone 'Europe/London')::date - make_interval(years => $2) - make_interval(days => $3))::date, $4)
             returning id, date_of_birth::text as dob, now() as now`, [CLINIC_A, years, days, sex]);
          for (const v of values) {
            // one order per value: results are unique per (order, test)
            const [oo] = await q<{ id: string }>(`insert into public.lab_orders (clinic_id, patient_id, ordered_by) values ($1, $2, $3) returning id`, [CLINIC_A, p!.id, "a0000000-0000-4000-8000-000000000002"]);
            const [r] = await q<{ flag: string; range_id: string | null }>(
              `insert into public.lab_results (clinic_id, order_id, patient_id, test_type_id, unit, value) values ($1, $2, $3, $4, '', $5) returning flag, range_id`,
              [CLINIC_A, oo!.id, p!.id, ID.typeHb, v]);
            const age = ageInYears(p!.dob, p!.now, "Europe/London");
            const ts = flagResult(v, ranges, sex, age);
            expect(r?.flag, `${sex} age ${age} value ${v}`).toBe(ts.flag);
            expect(r?.range_id ?? null, `${sex} age ${age} range`).toBe(ts.range?.id ?? null);
            n++;
          }
        }
      }
      expect(n).toBe(4 * 6 * 11);
    });
  });
});

describe("lab order status machine: SQL vs TypeScript", () => {
  it("agrees on all 16 transitions", async () => {
    const rows = await asOwner((q) =>
      q<{ f: string; t: string; ok: boolean }>(
        `select f, t, app.lab_order_transition_allowed(f, t) as ok from unnest($1::text[]) f, unnest($1::text[]) t`, [LAB_ORDER_STATUSES]),
    );
    expect(rows).toHaveLength(16);
    for (const r of rows) expect(r.ok, `${r.f} -> ${r.t}`).toBe(canTransitionLabOrder(r.f as never, r.t as never));
  });
});
