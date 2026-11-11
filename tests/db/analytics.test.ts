/**
 * Analytics against real Supabase Postgres: the lab-duration function gives
 * administrators numbers without patient information, and the TypeScript
 * statistics agree with Postgres percentile_cont.
 */
import { afterAll, describe, expect, it } from "vitest";
import { quantile } from "@/lib/rules/analytics";
import { act, as, asOwner, attempt, CLINIC_A, ID, pool, scenario, U, type Q } from "./helpers";

afterAll(() => pool.end());

const window = `now() - interval '2 days', now() + interval '1 hour'`;
const rows = (q: Q, from = "now() - interval '2 days'", to = "now() + interval '1 hour'") =>
  q<{ kind: string; minutes: number }>(`select kind, minutes::float8 as minutes from public.analytics_lab_durations(${from}, ${to})`);

/** Plant an order and a critical result with exact timestamps (triggers off), then restore the rules. */
async function plant(q: Q) {
  await q(`set local session_replication_role = replica`);
  const [o] = await q<{ id: string }>(
    `insert into public.lab_orders (clinic_id, patient_id, ordered_by, status, ordered_at) values ($1, $2, $3, 'resulted', now() - interval '5 hours') returning id`, [CLINIC_A, ID.amal, U.doctorA]);
  await q(
    `insert into public.lab_results (clinic_id, order_id, patient_id, test_type_id, unit, value, flag, entered_at, entered_by, acknowledged_at, acknowledged_by)
     values ($1, $2, $3, $4, 'mmol/L', 7.5, 'critical_high', now() - interval '5 hours' + interval '90 minutes', $5, now() - interval '5 hours' + interval '115 minutes', $6)`,
    [CLINIC_A, o!.id, ID.amal, ID.typeK, U.labA, U.doctorA]);
  await q(`set local session_replication_role = origin`);
}

describe("analytics_lab_durations", () => {
  it("is for administrators only", async () => {
    for (const u of ["doctorA", "labA", "deskA", "pharmA", "patientA"] as const) {
      await as(u, async (q) => { expect((await attempt(q, `select * from public.analytics_lab_durations(now() - interval '1 day', now())`)).error, u).toMatch(/Administrators only/); });
    }
    await as(null, async (q) => { expect((await attempt(q, `select * from public.analytics_lab_durations(now() - interval '1 day', now())`)).error).toMatch(/permission denied/); });
  });
  it("returns bare numbers: no patient, order or result identifiers", async () => {
    await as("adminA", async (q) => {
      const r = await q(`select * from public.analytics_lab_durations(now() - interval '2 days', now() + interval '1 hour')`);
      expect(r.length).toBeGreaterThan(0);
      expect(Object.keys(r[0] as object).sort()).toEqual(["kind", "minutes"]);
    });
  });
  it("measures turnaround and critical-acknowledgement time exactly", async () => {
    await scenario(async (q) => {
      await plant(q);
      await act(q, "adminA");
      const r = await rows(q);
      expect(r.filter((x) => x.kind === "lab_turnaround").map((x) => Math.round(x.minutes))).toContain(90);
      expect(r.filter((x) => x.kind === "critical_acknowledged").map((x) => Math.round(x.minutes))).toContain(25);
    });
  });
  it("respects the time window", async () => {
    await scenario(async (q) => {
      await plant(q);
      await act(q, "adminA");
      const r = await rows(q, "now() - interval '2 days'", "now() - interval '6 hours'");
      expect(r.filter((x) => x.kind !== "critical_open")).toEqual([]);
    });
  });
  it("lists critical results still waiting for acknowledgement", async () => {
    await as("adminA", async (q) => {
      const r = await rows(q);
      expect(r.filter((x) => x.kind === "critical_open")).toHaveLength(1); // Ravi's potassium in the seed
    });
  });
  it("never mixes clinics", async () => {
    await scenario(async (q) => {
      await plant(q);
      await act(q, "adminB");
      const r = await rows(q);
      expect(r.map((x) => x.kind).sort()).toEqual(["lab_turnaround"]); // Jon's haemoglobin order only
      expect(r.some((x) => Math.round(x.minutes) === 90)).toBe(false);
    });
  });
});

describe("quantile() agrees with Postgres percentile_cont", () => {
  const sets: number[][] = [
    [7], [1, 2], [1, 2, 3, 4], [5, 5, 5, 5, 5], Array.from({ length: 11 }, (_, i) => i + 1),
    [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9], [0, 0, 0, 180], [12.5, 0.25, 99.75, 40], Array.from({ length: 101 }, (_, i) => i * 3),
    [10, 10, 10, 10, 10, 10, 10, 10, 10, 600],
  ];
  it.each([0, 0.1, 0.5, 0.9, 1])("q = %f over %i datasets", async (q) => {
    await asOwner(async (db) => {
      for (const data of sets) {
        const [r] = await db<{ v: number }>(`select percentile_cont($1::float8) within group (order by x)::float8 as v from unnest($2::float8[]) x`, [q, data]);
        expect(quantile([...data].sort((a, b) => a - b), q), JSON.stringify(data)).toBeCloseTo(r!.v, 9);
      }
    });
  });
});
