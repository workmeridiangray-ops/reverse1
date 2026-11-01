/**
 * Parity: the TypeScript rules (lib/rules) and the database (migrations) must
 * compute the same answers on the same rows. If either side changes alone,
 * these tests fail.
 */
import { afterAll, describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES, canTransition } from "@/lib/rules/appointment-status";
import {
  type InsuranceStatus,
  type InvoiceInput,
  type InvoiceState,
  paymentStatus,
  summarizeInvoice,
} from "@/lib/rules/invoice";
import { asOwner, CLINIC_A, ID, pool } from "./helpers";

afterAll(() => pool.end());

describe("appointment status machine parity", () => {
  it("SQL and TS agree on all 36 transitions", async () => {
    const rows = await asOwner((q) =>
      q<{ f: string; t: string; ok: boolean }>(
        `select f::text, t::text, app.appointment_transition_allowed(f, t) as ok
         from unnest(enum_range(null::public.appointment_status)) f,
              unnest(enum_range(null::public.appointment_status)) t`,
      ),
    );
    expect(rows).toHaveLength(36);
    expect(rows.map((r) => r.f).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual([...APPOINTMENT_STATUSES].sort());
    for (const r of rows) {
      expect(r.ok, `${r.f} -> ${r.t}`).toBe(canTransition(r.f as never, r.t as never));
    }
  });
});

describe("payment status function parity", () => {
  it("app.invoice_payment_status matches paymentStatus over a grid of 1,368 inputs", async () => {
    const states: InvoiceState[] = ["draft", "issued", "void"];
    const ins: InsuranceStatus[] = ["none", "pending", "settled", "denied"];
    const totals = [0, 1, 999, 10000, 12345];
    const paid = [0, 1, 500, 999, 10000, 12346];
    const claimed = [0, 1, 999, 5000, 9999, 10000, 12345];
    const grid: Array<[InvoiceState, number, number, InsuranceStatus, number]> = [];
    for (const s of states)
      for (const t of totals)
        for (const p of paid)
          for (const i of ins)
            for (const c of claimed) if (c <= t) grid.push([s, t, p, i, c]);
    expect(grid.length).toBe(1368);

    const rows = await asOwner((q) =>
      q<{ n: number; status: string }>(
        `select g.n::int as n, app.invoice_payment_status(g.s::public.invoice_state, g.t, g.p, g.i::public.insurance_status, g.c) as status
         from jsonb_to_recordset($1::jsonb) as g(n int, s text, t bigint, p bigint, i text, c bigint)`,
        [JSON.stringify(grid.map(([s, t, p, i, c], n) => ({ n, s, t, p, i, c })))],
      ),
    );
    expect(rows).toHaveLength(grid.length);
    for (const r of rows) {
      const [state, totalMinor, patientPaidMinor, insuranceStatus, insuranceClaimedMinor] = grid[r.n]!;
      const ts = paymentStatus({ state, totalMinor, patientPaidMinor, insuranceStatus, insuranceClaimedMinor });
      expect(r.status, JSON.stringify(grid[r.n])).toBe(ts);
    }
  });
});

/**
 * Full-row parity: build real invoices through the real triggers (draft ->
 * lines -> issue -> claim -> payments -> settle/deny/void) and compare every
 * figure in public.invoice_balances with summarizeInvoice().
 */
interface Scenario {
  name: string;
  lines: Array<[qty: number, unit: number]>;
  claim?: number; // opened as pending before payments
  payments?: number[];
  final?: { status: InsuranceStatus; insurerPaid?: number };
  state?: InvoiceState; // default issued
}

const SCENARIOS: Scenario[] = [
  { name: "draft", lines: [[1, 5000]], state: "draft" },
  { name: "void draft", lines: [[1, 5000]], state: "void" },
  { name: "unpaid", lines: [[1, 5000], [3, 333]] },
  { name: "partial", lines: [[1, 5000]], payments: [1234] },
  { name: "several partials to paid", lines: [[2, 2500]], payments: [1000, 1000, 3000] },
  { name: "zero-total", lines: [] },
  { name: "free items", lines: [[5, 0]] },
  { name: "pending, nothing paid", lines: [[1, 10000]], claim: 8000 },
  { name: "pending, share paid", lines: [[1, 10000]], claim: 8000, payments: [2000] },
  { name: "pending, fully insured", lines: [[1, 10000]], claim: 10000 },
  { name: "settled in full", lines: [[1, 10000]], claim: 8000, payments: [2000], final: { status: "settled", insurerPaid: 8000 } },
  { name: "settled short (regression)", lines: [[1, 10000]], claim: 8000, payments: [2000], final: { status: "settled", insurerPaid: 6100 } },
  { name: "settled for zero", lines: [[1, 10000]], claim: 8000, payments: [2000], final: { status: "settled", insurerPaid: 0 } },
  { name: "settled, patient still owes", lines: [[1, 10000]], claim: 8000, payments: [500], final: { status: "settled", insurerPaid: 8000 } },
  { name: "denied", lines: [[1, 10000]], claim: 8000, payments: [2000], final: { status: "denied" } },
  { name: "claim withdrawn", lines: [[1, 10000]], claim: 8000, payments: [2000], final: { status: "none" } },
  { name: "big numbers", lines: [[10000, 99_999_999]], payments: [1] },
  { name: "odd cents", lines: [[3, 333], [7, 1]], claim: 1, payments: [999] },
];

describe("invoice row parity (TS summarizeInvoice vs SQL invoice_balances)", () => {
  it.each(SCENARIOS)("$name", async (sc) => {
    await asOwner(async (q) => {
      const [inv] = await q<{ id: string }>(
        `insert into public.invoices (clinic_id, patient_id) values ($1, $2) returning id`,
        [CLINIC_A, ID.george],
      );
      const id = inv!.id;
      for (const [qty, unit] of sc.lines) {
        await q(
          `insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values ($1, $2, 'line', $3, $4)`,
          [CLINIC_A, id, qty, unit],
        );
      }
      const finalState = sc.state ?? "issued";
      if (finalState === "void") {
        await q(`update public.invoices set state = 'void', void_reason = 'test' where id = $1`, [id]);
      } else if (finalState === "issued") {
        await q(`update public.invoices set state = 'issued' where id = $1`, [id]);
        if (sc.claim !== undefined) {
          await q(`update public.invoices set insurance_status = 'pending', insurance_claimed_minor = $2 where id = $1`, [id, sc.claim]);
        }
        for (const p of sc.payments ?? []) {
          await q(`insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, $3, 'cash')`, [CLINIC_A, id, p]);
        }
        if (sc.final) {
          await q(`update public.invoices set insurance_status = $2, insurance_paid_minor = $3 where id = $1`, [
            id,
            sc.final.status,
            sc.final.insurerPaid ?? 0,
          ]);
        }
      }

      const [db] = await q<Record<string, number | string>>(
        `select total_minor, patient_paid_minor, insurance_paid_minor, insurance_adjustment_minor,
                patient_responsibility_minor, balance_due_minor, patient_due_now_minor, payment_status
         from public.invoice_balances where invoice_id = $1`,
        [id],
      );

      // Read back what the database actually stored (triggers normalise insurance fields).
      const [stored] = await q<{ state: InvoiceState; insurance_status: InsuranceStatus; insurance_claimed_minor: number; insurance_paid_minor: number }>(
        `select state, insurance_status, insurance_claimed_minor, insurance_paid_minor from public.invoices where id = $1`,
        [id],
      );
      const input: InvoiceInput = {
        state: stored!.state,
        lines: sc.lines.map(([quantity, unitPriceMinor]) => ({ quantity, unitPriceMinor })),
        paymentsMinor: finalState === "issued" ? (sc.payments ?? []) : [],
        insuranceStatus: stored!.insurance_status,
        insuranceClaimedMinor: stored!.insurance_claimed_minor,
        insurancePaidMinor: stored!.insurance_paid_minor,
      };
      const ts = summarizeInvoice(input);
      expect(db).toEqual({
        total_minor: ts.totalMinor,
        patient_paid_minor: ts.patientPaidMinor,
        insurance_paid_minor: ts.insurancePaidMinor,
        insurance_adjustment_minor: ts.insuranceAdjustmentMinor,
        patient_responsibility_minor: ts.patientResponsibilityMinor,
        balance_due_minor: ts.balanceDueMinor,
        patient_due_now_minor: ts.patientDueNowMinor,
        payment_status: ts.status,
      });
    });
  });

  it("the regression scenario really ends as paid on both sides", async () => {
    const ts = summarizeInvoice({
      state: "issued",
      lines: [{ quantity: 1, unitPriceMinor: 10000 }],
      paymentsMinor: [2000],
      insuranceStatus: "settled",
      insuranceClaimedMinor: 8000,
      insurancePaidMinor: 6100,
    });
    expect(ts.status).toBe("paid");
  });
});
