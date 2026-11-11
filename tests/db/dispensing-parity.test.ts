/**
 * Parity: lib/rules/dispensing.ts vs public.dispense_prescription().
 * For many stock situations the TypeScript plan and the database must agree on
 * what is flagged, and the database must demand a note exactly when the
 * TypeScript says one is needed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { addDays, expiresMidCourse, flagsFor, noteReasons, planDispense, type StockBatch } from "@/lib/rules/dispensing";
import { act, asOwner, CLINIC_A, ID, pool, probe, type Q, U } from "./helpers";

afterAll(() => pool.end());

describe("expires_mid_course: SQL vs TypeScript", () => {
  it("agrees across expiry offsets and course lengths", async () => {
    const start = "2026-11-11";
    const offsets = Array.from({ length: 75 }, (_, i) => i - 10); // -10 .. +64 days
    const covers: Array<number | null> = [null, 0, 1, 2, 7, 10, 30, 60];
    const cases = offsets.flatMap((o) => covers.map((c) => ({ expiry: addDays(start, o), cover: c })));
    const rows = await asOwner((q) =>
      q<{ n: number; r: boolean }>(
        `select g.n::int as n, app.expires_mid_course(g.expiry::date, $2::date, g.cover) as r
           from jsonb_to_recordset($1::jsonb) as g(n int, expiry text, cover int)`,
        [JSON.stringify(cases.map((c, n) => ({ n, ...c }))), start]),
    );
    expect(rows).toHaveLength(cases.length);
    for (const r of rows) {
      const c = cases[r.n]!;
      expect(r.r, JSON.stringify(c)).toBe(expiresMidCourse(c.expiry, start, c.cover));
    }
  });
});

interface Spec { offset: number; qty: number; status?: "available" | "quarantined" | "recalled" }
const SCENARIOS: Spec[][] = [
  [{ offset: 20, qty: 100 }, { offset: 200, qty: 200 }],
  [{ offset: 20, qty: 100 }, { offset: 90, qty: 50 }, { offset: 200, qty: 200 }],
  [{ offset: -3, qty: 50 }, { offset: 50, qty: 50, status: "quarantined" }, { offset: 80, qty: 10 }, { offset: 120, qty: 500 }],
  [{ offset: 10, qty: 5 }, { offset: 10, qty: 5 }, { offset: 40, qty: 100 }],
  [{ offset: 60, qty: 99, status: "recalled" }, { offset: 30, qty: 40 }, { offset: 35, qty: 200 }],
  [{ offset: 0, qty: 25 }, { offset: 1, qty: 25 }, { offset: 29, qty: 400 }, { offset: 30, qty: 400 }],
];

async function setup(q: Q, i: number, specs: Spec[]) {
  const [p] = await q<{ id: string }>(
    `insert into public.stock_products (clinic_id, name, unit, drug_classes) values ($1, $2, 'tablet', '{statin}') returning id`, [CLINIC_A, `Parity product ${i}`]);
  for (const [j, s] of specs.entries()) {
    await q(
      `insert into public.stock_batches (clinic_id, product_id, batch_number, expiry_date, quantity_received, status, status_note)
       values ($1, $2, $3, current_date + $4::integer, $5, $6, $7)`,
      [CLINIC_A, p!.id, `B${j}`, s.offset, s.qty, s.status ?? "available", s.status && s.status !== "available" ? "Parity test status" : null]);
  }
  const today = (await q<{ d: string }>(`select app.clinic_today($1)::text as d`, [CLINIC_A]))[0]!.d;
  const batches = await q<{ id: string; batch_number: string; expiry_date: string; quantity_on_hand: number; status: StockBatch["status"] }>(
    `select id, batch_number, expiry_date::text, quantity_on_hand, status from public.stock_batches where product_id = $1`, [p!.id]);
  return {
    productId: p!.id, today,
    stock: batches.map((b): StockBatch => ({ id: b.id, batchNumber: b.batch_number, expiryDate: b.expiry_date, onHand: b.quantity_on_hand, status: b.status })),
  };
}

describe("dispense_prescription: TypeScript plan vs database, scenario by scenario", () => {
  it(`agrees on flags and on when a note is required (${SCENARIOS.length} stock situations)`, async () => {
    let probes = 0;
    await asOwner(async (q) => {
      for (const [i, specs] of SCENARIOS.entries()) {
        const { productId, today, stock } = await setup(q, i, specs);
        for (const quantity of [10, 60, 130]) {
          for (const cover of [null, 7, 30] as const) {
            for (const avoidMidCourse of [false, true]) {
              const plan = planDispense({ batches: stock, quantity, today, coverDays: cover, avoidMidCourse });
              if (plan.shortfall > 0) continue; // not enough usable stock: nothing to dispense
              const allocations = plan.allocations.map((a) => ({ batch_id: a.batchId, quantity: a.quantity }));
              const needs = noteReasons(plan.flags, false);
              const call = (note: string | null) => async () => {
                await act(q, null);
                const [rx] = await q<{ id: string }>(
                  `insert into public.prescriptions (clinic_id, patient_id, prescriber_id, drug_name, dose, route, frequency, drug_classes, status)
                   values ($1, $2, $3, 'Parity drug', '1 tablet', 'oral', 'daily', '{statin}', 'active') returning id`, [CLINIC_A, ID.ravi, U.doctorA]);
                await act(q, "pharmA");
                const [d] = await q<{ id: string }>(`select public.dispense_prescription($1, $2, $3::jsonb, $4, $5) as id`, [rx!.id, productId, JSON.stringify(allocations), cover, note]);
                const [row] = await q<{ mid_course: boolean; fefo_skipped: boolean; allergy_flagged: boolean }>(`select mid_course, fefo_skipped, allergy_flagged from public.dispenses where id = $1`, [d!.id]);
                const items = await q<{ batch_id: string; mid_course: boolean }>(`select batch_id, mid_course from public.dispense_items where dispense_id = $1`, [d!.id]);
                return { row: row!, items };
              };
              const label = `scenario ${i}, qty ${quantity}, cover ${cover}, avoid ${avoidMidCourse}`;

              // 1. With a note it always works, and the stored flags equal the TypeScript flags.
              const withNote = await probe(q, call("A written note that is long enough."));
              probes++;
              expect(withNote.ok, `${label}: ${(withNote as { error?: string }).error}`).toBe(true);
              if (withNote.ok) {
                expect(withNote.value.row, label).toEqual({ mid_course: plan.flags.midCourse, fefo_skipped: plan.flags.fefoSkipped, allergy_flagged: false });
                for (const it of withNote.value.items) {
                  expect(it.mid_course, `${label} item`).toBe(plan.allocations.find((a) => a.batchId === it.batch_id)!.midCourse);
                }
              }
              // 2. Without a note: refused exactly when the TypeScript says a note is needed.
              const withoutNote = await probe(q, call(null));
              probes++;
              expect(withoutNote.ok, `${label} (no note)`).toBe(needs.length === 0);
              if (!withoutNote.ok) expect(withoutNote.error).toMatch(/written note/);
              // 3. The same flags come back from flagsFor() for the allocation we sent.
              expect(flagsFor(plan.allocations, stock, today, cover), label).toEqual(plan.flags);
            }
          }
        }
      }
    });
    expect(probes).toBeGreaterThan(100);
  });
});
