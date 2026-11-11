/**
 * Pharmacy against real Supabase Postgres: the stock ledger and batch
 * dispensing safety rules. Every test runs in a rolled-back transaction.
 */
import { afterAll, describe, expect, it } from "vitest";
import { act, as, attempt, CLINIC_A, CLINIC_B, commitStep, ID, pool, scenario, type Q, U } from "./helpers";

afterAll(() => pool.end());

const LONG = "Longer-dated batch used and patient counselled on storage.";
const dispense = (q: Q, rx: string, product: string, allocations: Array<{ batch_id: string; quantity: number }>, cover: number | null, note: string | null) =>
  q<{ id: string }>(`select public.dispense_prescription($1, $2, $3::jsonb, $4, $5) as id`, [rx, product, JSON.stringify(allocations), cover, note]);
const onHand = async (q: Q, batch: string) => (await q<{ n: number }>(`select quantity_on_hand as n from public.stock_batches where id = $1`, [batch]))[0]!.n;
const status = async (q: Q, rx: string) => (await q<{ status: string }>(`select status from public.prescriptions where id = $1`, [rx]))[0]!.status;
/** Try a dispense; return the database's refusal message ("" if it succeeded). A refusal is rolled back so the test can carry on. */
const refuse = async (q: Q, rx: string, product: string, a: Array<{ batch_id: string; quantity: number }>, cover: number | null, note: string | null) => {
  await q("savepoint refuse");
  try { await dispense(q, rx, product, a, cover, note); await q("release savepoint refuse"); return ""; }
  catch (e) { await q("rollback to savepoint refuse"); return (e as Error).message; }
};

describe("receiving stock", () => {
  const newBatch = `insert into public.stock_batches (clinic_id, product_id, batch_number, expiry_date, quantity_received, supplier)
                    values ($1, $2, $3, current_date + $4::integer, $5, 'Test supplier') returning id`;
  it("a pharmacist receives a batch: on-hand comes from the ledger, not from the form", async () => {
    await as("pharmA", async (q) => {
      const [b] = await q<{ id: string }>(newBatch, [CLINIC_A, ID.prodIbuprofen, "IBU-1", 300, 80]);
      expect(await onHand(q, b!.id)).toBe(80);
      const m = await q<{ delta: number; reason: string; created_by: string }>(`select delta, reason, created_by from public.stock_movements where batch_id = $1`, [b!.id]);
      expect(m).toEqual([{ delta: 80, reason: "received", created_by: U.pharmA }]);
    });
  });
  it("refuses an already-expired batch, a repeated batch number and another clinic's product", async () => {
    await as("pharmA", async (q) => {
      expect((await attempt(q, newBatch, [CLINIC_A, ID.prodIbuprofen, "OLD", -1, 10])).error).toMatch(/already expired/);
      expect((await attempt(q, newBatch, [CLINIC_A, ID.prodFerrous, "F-101", 300, 10])).error).toMatch(/duplicate|unique/);
      expect((await attempt(q, newBatch, [CLINIC_A, ID.prodParacetamolB, "X", 300, 10])).error).toMatch(/foreign key/);
    });
  });
  it.each(["adminA", "doctorA", "deskA", "labA", "patientA"] as const)("%s cannot receive stock", async (u) => {
    await as(u, async (q) => {
      expect((await attempt(q, newBatch, [CLINIC_A, ID.prodIbuprofen, "IBU-2", 300, 10])).error).toMatch(/row-level security/);
    });
  });
  it("the administrator can see stock (read-only) and manage the product list", async () => {
    await as("adminA", async (q) => {
      expect((await q(`select id from public.stock_batches`)).length).toBe(6);
      expect((await attempt(q, `update public.stock_batches set status = 'recalled', status_note = 'x y z' where id = $1 returning id`, [ID.batchF101])).rows).toBe(0);
      expect((await attempt(q, `insert into public.stock_products (clinic_id, name, unit, drug_classes) values ($1, 'Salbutamol inhaler', 'puff', '{beta_agonist}')`, [CLINIC_A])).ok).toBe(true);
    });
  });
});

describe("the stock ledger", () => {
  it("on-hand cannot be edited directly, and batch details are fixed once received", async () => {
    await as("pharmA", async (q) => {
      expect((await attempt(q, `update public.stock_batches set quantity_on_hand = 9999 where id = $1`, [ID.batchF101])).error).toMatch(/through stock movements only/);
      expect((await attempt(q, `update public.stock_batches set expiry_date = expiry_date + 365 where id = $1`, [ID.batchF101])).error).toMatch(/cannot be changed/);
      expect((await attempt(q, `update public.stock_batches set batch_number = 'FAKE' where id = $1`, [ID.batchF101])).error).toMatch(/cannot be changed/);
    });
  });
  it("movements for receiving and dispensing cannot be forged", async () => {
    await as("pharmA", async (q) => {
      const ins = (delta: number, reason: string, dispense: string | null = null) =>
        attempt(q, `insert into public.stock_movements (clinic_id, batch_id, delta, reason, dispense_id) values ($1, $2, $3, $4, $5)`, [CLINIC_A, ID.batchF101, delta, reason, dispense]);
      expect((await ins(500, "received")).error).toMatch(/adding a batch/);
      expect((await ins(-5, "dispensed")).error).toMatch(/must match a dispense/);
      expect((await ins(500, "adjustment")).error).toMatch(/check constraint/); // adjustment needs a note
    });
  });
  it("write-offs and corrections need a reason, cannot overdraw, and stay in the ledger", async () => {
    await as("pharmA", async (q) => {
      expect((await attempt(q, `select public.adjust_stock($1, -10, 'write_off', '')`, [ID.batchP1Expired])).error).toMatch(/check constraint/);
      expect((await attempt(q, `select public.adjust_stock($1, -41, 'write_off', 'Expired stock disposed')`, [ID.batchP1Expired])).error).toMatch(/Not enough stock/);
      expect((await attempt(q, `select public.adjust_stock($1, -40, 'write_off', 'Expired stock disposed')`, [ID.batchP1Expired])).ok).toBe(true);
      expect(await onHand(q, ID.batchP1Expired)).toBe(0);
      expect((await attempt(q, `select public.adjust_stock($1, 5, 'received', 'x y z')`, [ID.batchP1Expired])).error).toMatch(/Unknown reason/);
    });
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.adjust_stock($1, -1, 'write_off', 'nope nope')`, [ID.batchP2])).error).toMatch(/Only a pharmacist/);
    });
  });
  it("the ledger is append-only for every role", async () => {
    await as("pharmA", async (q) => {
      expect((await attempt(q, `update public.stock_movements set delta = 1`)).error).toMatch(/permission denied/);
      expect((await attempt(q, `delete from public.stock_movements`)).error).toMatch(/permission denied/);
    });
    await scenario(async (q) => {
      expect((await attempt(q, `update public.stock_movements set note = 'x'`)).error).toMatch(/cannot be changed or deleted/);
    });
  });
  it("quarantine needs a note; recall is final", async () => {
    await as("pharmA", async (q) => {
      expect((await attempt(q, `update public.stock_batches set status = 'quarantined' where id = $1`, [ID.batchF101])).ok).toBe(false);
      expect((await attempt(q, `update public.stock_batches set status = 'quarantined', status_note = 'Cold-chain alarm' where id = $1`, [ID.batchF101])).ok).toBe(true);
      expect((await attempt(q, `update public.stock_batches set status = 'available' where id = $1`, [ID.batchF101])).ok).toBe(true); // quarantine can be lifted
      expect((await attempt(q, `update public.stock_batches set status = 'recalled', status_note = 'Supplier recall 2026-11' where id = $1`, [ID.batchF101])).ok).toBe(true);
      expect((await attempt(q, `update public.stock_batches set status = 'available' where id = $1`, [ID.batchF101])).error).toMatch(/cannot be released/);
    });
  });
});

describe("dispensing: first-expiry-first-out and the mid-course flag", () => {
  it("THE SCENARIO: a batch in date today but expiring 20 days into a 30-day course needs a written note", async () => {
    await as("pharmA", async (q) => {
      // F-101 expires in 20 days; the course is 30 days.
      const noNote = await refuse(q, ID.rxActive, ID.prodFerrous, [{ batch_id: ID.batchF101, quantity: 60 }], 30, null);
      expect(noNote).toMatch(/written note .* a batch expires before the course ends/);
    });
  });
  it("...with a note it is allowed, recorded as mid-course, and stock and prescription update atomically", async () => {
    await as("pharmA", async (q) => {
      const [d] = await dispense(q, ID.rxActive, ID.prodFerrous, [{ batch_id: ID.batchF101, quantity: 60 }], 30, "Supply to be topped up from F-102 at day 15.");
      const [row] = await q<{ mid_course: boolean; fefo_skipped: boolean; allergy_flagged: boolean; quantity: number; dispensed_by: string }>(
        `select mid_course, fefo_skipped, allergy_flagged, quantity, dispensed_by from public.dispenses where id = $1`, [d!.id]);
      expect(row).toEqual({ mid_course: true, fefo_skipped: false, allergy_flagged: false, quantity: 60, dispensed_by: U.pharmA });
      const [item] = await q<{ mid_course: boolean; quantity: number }>(`select mid_course, quantity from public.dispense_items where dispense_id = $1`, [d!.id]);
      expect(item).toEqual({ mid_course: true, quantity: 60 });
      expect(await onHand(q, ID.batchF101)).toBe(40);
      expect(await status(q, ID.rxActive)).toBe("dispensed");
      const m = await q<{ delta: number; reason: string; dispense_id: string }>(`select delta, reason, dispense_id from public.stock_movements where reason = 'dispensed'`);
      expect(m).toEqual([{ delta: -60, reason: "dispensed", dispense_id: d!.id }]);
    });
  });
  it("choosing the longer-dated batch avoids the mid-course flag but is a FEFO departure, which also needs a note", async () => {
    await as("pharmA", async (q) => {
      const a = [{ batch_id: ID.batchF102, quantity: 60 }];
      expect(await refuse(q, ID.rxActive, ID.prodFerrous, a, 30, null)).toMatch(/an earlier-expiry batch was skipped/);
      const [d] = await dispense(q, ID.rxActive, ID.prodFerrous, a, 30, "Avoided F-101, which expires mid-course.");
      const [row] = await q<{ mid_course: boolean; fefo_skipped: boolean }>(`select mid_course, fefo_skipped from public.dispenses where id = $1`, [d!.id]);
      expect(row).toEqual({ mid_course: false, fefo_skipped: true });
    });
  });
  it("with no course length and the earliest batch, nothing is flagged and no note is needed", async () => {
    await as("pharmA", async (q) => {
      const [d] = await dispense(q, ID.rxActive, ID.prodFerrous, [{ batch_id: ID.batchF101, quantity: 30 }], null, null);
      const [row] = await q<{ mid_course: boolean; fefo_skipped: boolean; pharmacist_note: string | null }>(`select mid_course, fefo_skipped, pharmacist_note from public.dispenses where id = $1`, [d!.id]);
      expect(row).toEqual({ mid_course: false, fefo_skipped: false, pharmacist_note: null });
    });
  });
  it("spans batches first-expiry-first: using up F-101 then F-102 is not a skip", async () => {
    await as("pharmA", async (q) => {
      const [d] = await dispense(q, ID.rxActive, ID.prodFerrous, [{ batch_id: ID.batchF101, quantity: 100 }, { batch_id: ID.batchF102, quantity: 20 }], null, null);
      expect((await q(`select 1 from public.dispense_items where dispense_id = $1`, [d!.id])).length).toBe(2);
      expect(await onHand(q, ID.batchF101)).toBe(0);
      expect(await onHand(q, ID.batchF102)).toBe(180);
    });
  });
});

describe("dispensing: hard refusals", () => {
  it("refuses expired, quarantined, over-drawn, wrong-product, duplicate, empty and zero allocations", async () => {
    await as("pharmA", async (q) => {
      const go = (rx: string, product: string, a: Array<{ batch_id: string; quantity: number }>) => refuse(q, rx, product, a, null, LONG);
      expect(await go(ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP1Expired, quantity: 5 }])).toMatch(/has expired/);
      expect(await go(ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP3Quarantined, quantity: 5 }])).toMatch(/quarantined/);
      expect(await go(ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 301 }])).toMatch(/Only 300 left/);
      expect(await go(ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchF101, quantity: 5 }])).toMatch(/not stock of this medicine/);
      expect(await go(ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 5 }, { batch_id: ID.batchP2, quantity: 5 }])).toMatch(/listed twice/);
      expect(await go(ID.rxParacetamol, ID.prodParacetamol, [])).toMatch(/at least one batch/);
      expect(await go(ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 0 }])).toMatch(/positive/);
    });
  });
  it("refuses a recalled batch", async () => {
    await scenario(async (q) => {
      await act(q, "pharmA");
      await q(`update public.stock_batches set status = 'recalled', status_note = 'Supplier recall' where id = $1`, [ID.batchP2]);
      expect(await refuse(q, ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 5 }], null, LONG)).toMatch(/recalled/);
    });
  });
  it("refuses the wrong product for the prescription, an inactive prescription and a second dispense", async () => {
    await as("pharmA", async (q) => {
      expect(await refuse(q, ID.rxParacetamol, ID.prodFerrous, [{ batch_id: ID.batchF102, quantity: 5 }], null, LONG)).toMatch(/does not match the prescribed medicine/);
    });
    await as("pharmA", async (q) => {
      expect(await refuse(q, ID.rxDraft, ID.prodFerrous, [{ batch_id: ID.batchF102, quantity: 5 }], null, LONG)).toMatch(/not active/);
    });
    await as("pharmA", async (q) => {
      await dispense(q, ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 40 }], 5, null);
      expect(await refuse(q, ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 40 }], 5, null)).toMatch(/not active/);
    });
  });
  it("a failure leaves nothing half-done: no stock moved, prescription still active, no dispense record", async () => {
    await as("pharmA", async (q) => {
      const bad = await commitStep(q, () => dispense(q, ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 10 }, { batch_id: ID.batchP1Expired, quantity: 1 }], null, LONG));
      expect(bad.ok).toBe(false);
      expect(await onHand(q, ID.batchP2)).toBe(300);
      expect(await status(q, ID.rxParacetamol)).toBe("active");
      expect((await q(`select id from public.dispenses`)).length).toBe(0);
    });
  });
  it("the ledger always equals on-hand after dispensing", async () => {
    await as("pharmA", async (q) => {
      await dispense(q, ID.rxActive, ID.prodFerrous, [{ batch_id: ID.batchF101, quantity: 100 }, { batch_id: ID.batchF102, quantity: 20 }], null, null);
      await q(`select public.adjust_stock($1, -7, 'adjustment', 'Count correction')`, [ID.batchF102]);
      const rows = await q<{ on_hand: number; ledger: number }>(
        `select b.quantity_on_hand as on_hand, coalesce((select sum(m.delta) from public.stock_movements m where m.batch_id = b.id), 0)::int as ledger from public.stock_batches b`);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.on_hand).toBe(r.ledger);
    });
  });
});

describe("dispensing: allergies and roles", () => {
  it("an allergy to the medicine's class needs a note even if the stock is fine", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      // Penicillin-allergic Amal, amoxicillin prescribed with an override reason (Phase 2 rule).
      const [rx] = await q<{ id: string }>(
        `insert into public.prescriptions (clinic_id, patient_id, prescriber_id, drug_name, dose, route, frequency, duration_days, drug_classes, allergy_override_reason, status)
         values ($1, $2, $3, 'Amoxicillin', '1 capsule', 'oral', 'three times daily', 7, '{penicillin}', 'Culture-proven; counselled.', 'active') returning id`, [CLINIC_A, ID.amal, U.doctorA]);
      await act(q, "pharmA");
      const a = [{ batch_id: ID.batchAmx, quantity: 21 }];
      expect(await refuse(q, rx!.id, ID.prodAmox, a, 7, null)).toMatch(/recorded allergy/);
      const [d] = await dispense(q, rx!.id, ID.prodAmox, a, 7, "Allergy known and overridden by prescriber; patient re-counselled.");
      const [row] = await q<{ allergy_flagged: boolean }>(`select allergy_flagged from public.dispenses where id = $1`, [d!.id]);
      expect(row?.allergy_flagged).toBe(true);
    });
  });
  it("an allergy recorded AFTER prescribing is caught at the shelf", async () => {
    await scenario(async (q) => {
      await act(q, "doctorA");
      await q(`insert into public.patient_allergies (clinic_id, patient_id, kind, allergen, allergen_class, severity) values ($1, $2, 'allergy', 'Paracetamol', 'paracetamol', 'mild')`, [CLINIC_A, ID.owen]);
      await act(q, "pharmA");
      expect(await refuse(q, ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 40 }], 5, null)).toMatch(/recorded allergy/);
    });
  });
  it.each(["adminA", "doctorA", "deskA", "labA", "patientA"] as const)("%s cannot dispense", async (u) => {
    await as(u, async (q) => {
      expect(await refuse(q, ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 5 }], null, null)).toMatch(/Only a pharmacist/);
    });
  });
  it("another clinic's pharmacist cannot see, dispense or take stock from this clinic", async () => {
    await scenario(async (q) => {
      const id = "b0000000-0000-4000-8000-0000000000aa";
      await q(`insert into auth.users (id, instance_id, aud, role, email) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pharm@northgate.test')`, [id]);
      await q(`insert into public.profiles (id, clinic_id, role, full_name) values ($1, $2, 'pharmacist', 'Northgate Pharmacist')`, [id, CLINIC_B]);
      await q("reset role");
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: "authenticated", aud: "authenticated" })]);
      await q("set local role authenticated");
      expect((await q(`select id from public.prescriptions`)).length).toBe(0);
      expect((await q(`select id from public.stock_batches`)).map((r) => (r as { id: string }).id)).toEqual([ID.batchN1]);
      expect(await refuse(q, ID.rxParacetamol, ID.prodParacetamol, [{ batch_id: ID.batchP2, quantity: 5 }], null, null)).toMatch(/Prescription not found/);
      expect((await attempt(q, `select public.adjust_stock($1, -1, 'write_off', 'not mine')`, [ID.batchP2])).error).toMatch(/Batch not found|foreign key/);
    });
  });

});

describe("dispensing records", () => {
  it("are immutable, visible to doctors and the patient, hidden from reception, and traceable by batch", async () => {
    await scenario(async (q) => {
      await act(q, "pharmA");
      const [d] = await dispense(q, ID.rxActive, ID.prodFerrous, [{ batch_id: ID.batchF101, quantity: 30 }], null, null);
      expect((await attempt(q, `update public.dispenses set quantity = 1`)).error).toMatch(/permission denied/);
      expect((await attempt(q, `delete from public.dispense_items`)).error).toMatch(/permission denied/);
      // Recall trace: who received stock from this batch?
      const trace = await q<{ patient_id: string; quantity: number }>(
        `select d.patient_id, i.quantity from public.dispense_items i join public.dispenses d on d.id = i.dispense_id where i.batch_id = $1`, [ID.batchF101]);
      expect(trace).toEqual([{ patient_id: ID.amal, quantity: 30 }]);
      await act(q, "doctorA");
      expect((await q(`select id from public.dispenses where id = $1`, [d!.id])).length).toBe(1);
      await act(q, "patientA");
      expect((await q(`select id from public.dispenses where id = $1`, [d!.id])).length).toBe(1);
      expect((await q(`select id from public.dispense_items`)).length).toBe(1);
      await act(q, "deskA");
      expect((await q(`select id from public.dispenses`)).length).toBe(0);
      await act(q, "patientB");
      expect((await q(`select id from public.dispenses`)).length).toBe(0);
    });
  });
  it("are audited with field names only", async () => {
    await scenario(async (q) => {
      await act(q, "pharmA");
      await dispense(q, ID.rxActive, ID.prodFerrous, [{ batch_id: ID.batchF101, quantity: 30 }], null, null);
      await act(q, null);
      const rows = await q<{ actor_role: string; action: string; table_name: string }>(`select actor_role, action, table_name from public.audit_log where table_name in ('dispenses', 'stock_batches') order by id desc limit 3`);
      expect(rows.some((r) => r.table_name === "dispenses" && r.action === "insert" && r.actor_role === "pharmacist")).toBe(true);
    });
  });
});
