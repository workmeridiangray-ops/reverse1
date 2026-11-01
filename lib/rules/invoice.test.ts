import { describe, expect, it } from "vitest";
import {
  type InvoiceInput,
  InvoiceError,
  invoiceTotal,
  patientOwesNow,
  paymentStatus,
  summarizeInvoice,
  validateInsurance,
  validatePayment,
} from "./invoice";

const base: InvoiceInput = {
  state: "issued",
  lines: [
    { quantity: 1, unitPriceMinor: 8000 }, // consultation 80.00
    { quantity: 2, unitPriceMinor: 1000 }, // dressing x2 20.00
  ],
  paymentsMinor: [],
  insuranceStatus: "none",
  insuranceClaimedMinor: 0,
  insurancePaidMinor: 0,
};

describe("invoiceTotal", () => {
  it("sums quantity x unit price", () => {
    expect(invoiceTotal(base.lines)).toBe(10000);
    expect(invoiceTotal([])).toBe(0);
  });
});

describe("summarizeInvoice without insurance", () => {
  it("is unpaid with no payments", () => {
    const s = summarizeInvoice(base);
    expect(s).toMatchObject({ totalMinor: 10000, balanceDueMinor: 10000, patientDueNowMinor: 10000, status: "unpaid" });
  });
  it("accepts several partial payments", () => {
    const s = summarizeInvoice({ ...base, paymentsMinor: [2500, 2500] });
    expect(s).toMatchObject({ patientPaidMinor: 5000, balanceDueMinor: 5000, status: "partially_paid" });
  });
  it("is paid when payments match the total", () => {
    const s = summarizeInvoice({ ...base, paymentsMinor: [3333, 3333, 3334] });
    expect(s).toMatchObject({ balanceDueMinor: 0, patientDueNowMinor: 0, status: "paid" });
  });
  it("reports overpayment as a negative balance", () => {
    const s = summarizeInvoice({ ...base, paymentsMinor: [10001] });
    expect(s).toMatchObject({ balanceDueMinor: -1, patientDueNowMinor: 0, status: "overpaid" });
  });
  it("zero-total issued invoice is paid", () => {
    expect(summarizeInvoice({ ...base, lines: [] }).status).toBe("paid");
  });
  it("rejects zero or float payments", () => {
    expect(() => summarizeInvoice({ ...base, paymentsMinor: [0] })).toThrow(InvoiceError);
    expect(() => summarizeInvoice({ ...base, paymentsMinor: [10.5] })).toThrow();
  });
});

describe("summarizeInvoice states", () => {
  it("draft and void owe nothing", () => {
    expect(summarizeInvoice({ ...base, state: "draft" })).toMatchObject({ status: "draft", balanceDueMinor: 0 });
    expect(summarizeInvoice({ ...base, state: "void", paymentsMinor: [500] })).toMatchObject({
      status: "void",
      balanceDueMinor: 0,
    });
  });
});

describe("summarizeInvoice with insurance", () => {
  const insured: InvoiceInput = { ...base, insuranceStatus: "pending", insuranceClaimedMinor: 8000 };

  it("pending claim: patient owes only their share", () => {
    const s = summarizeInvoice(insured);
    expect(s).toMatchObject({ patientResponsibilityMinor: 2000, patientDueNowMinor: 2000, status: "unpaid" });
  });
  it("pending claim with patient share paid is awaiting insurance, not partially paid", () => {
    const s = summarizeInvoice({ ...insured, paymentsMinor: [2000] });
    expect(s).toMatchObject({ patientDueNowMinor: 0, balanceDueMinor: 8000, status: "awaiting_insurance" });
  });
  it("fully-insured pending claim with nothing paid is awaiting insurance", () => {
    expect(summarizeInvoice({ ...base, insuranceStatus: "pending", insuranceClaimedMinor: 10000 }).status).toBe(
      "awaiting_insurance",
    );
  });
  it("settled claim paid in full closes the invoice", () => {
    const s = summarizeInvoice({ ...insured, insuranceStatus: "settled", insurancePaidMinor: 8000, paymentsMinor: [2000] });
    expect(s).toMatchObject({ balanceDueMinor: 0, insuranceAdjustmentMinor: 0, status: "paid" });
  });
  it("REGRESSION: settled for less than claimed is paid, not 'partially paid' forever", () => {
    const s = summarizeInvoice({ ...insured, insuranceStatus: "settled", insurancePaidMinor: 6500, paymentsMinor: [2000] });
    expect(s).toMatchObject({
      insurancePaidMinor: 6500,
      insuranceAdjustmentMinor: 1500,
      balanceDueMinor: 0,
      status: "paid",
    });
  });
  it("settled claim with patient share still owing is partially paid", () => {
    const s = summarizeInvoice({ ...insured, insuranceStatus: "settled", insurancePaidMinor: 8000 });
    expect(s).toMatchObject({ balanceDueMinor: 2000, patientDueNowMinor: 2000, status: "partially_paid" });
  });
  it("denied claim falls back to the patient", () => {
    const s = summarizeInvoice({ ...insured, insuranceStatus: "denied", paymentsMinor: [2000] });
    expect(s).toMatchObject({ patientResponsibilityMinor: 10000, patientDueNowMinor: 8000, status: "partially_paid" });
  });
  it("claim larger than the total is rejected", () => {
    expect(() => summarizeInvoice({ ...insured, insuranceClaimedMinor: 10001 })).toThrow(/exceed the invoice total/);
  });
  it("insurer paying more than claimed is rejected", () => {
    expect(validateInsurance(10000, 5000, 5001)).toEqual(["Insurer payment cannot exceed the amount claimed."]);
  });
  it("status 'none' ignores stale claim figures", () => {
    const s = summarizeInvoice({ ...base, insuranceStatus: "none", insuranceClaimedMinor: 99999, insurancePaidMinor: 99999 });
    expect(s.status).toBe("unpaid");
  });
});

describe("paymentStatus matrix", () => {
  // Every combination stays within the declared set and never throws.
  it("is total over the input space", () => {
    const states = ["draft", "issued", "void"] as const;
    const ins = ["none", "pending", "settled", "denied"] as const;
    for (const state of states)
      for (const insuranceStatus of ins)
        for (const paid of [0, 1, 50, 100, 101])
          for (const claimed of [0, 50, 100]) {
            const s = paymentStatus({ state, totalMinor: 100, patientPaidMinor: paid, insuranceStatus, insuranceClaimedMinor: claimed });
            expect(["draft", "void", "unpaid", "partially_paid", "awaiting_insurance", "paid", "overpaid"]).toContain(s);
          }
  });
});

describe("validatePayment", () => {
  it("allows a partial payment", () => {
    expect(validatePayment(summarizeInvoice(base), 4000)).toEqual([]);
  });
  it("blocks overpaying, zero, drafts and voids", () => {
    expect(validatePayment(summarizeInvoice(base), 10001)).toEqual(["Payment is more than the patient currently owes."]);
    expect(validatePayment(summarizeInvoice(base), 0)).toContain("Payment must be greater than zero.");
    expect(validatePayment(summarizeInvoice({ ...base, state: "draft" }), 100)).toContain(
      "Issue the invoice before taking payment.",
    );
    expect(validatePayment(summarizeInvoice({ ...base, state: "void" }), 100)).toContain("This invoice is void.");
  });
  it("does not let reception take the insurer's share while the claim is pending", () => {
    const s = summarizeInvoice({ ...base, insuranceStatus: "pending", insuranceClaimedMinor: 8000 });
    expect(validatePayment(s, 2001)).toHaveLength(1);
    expect(validatePayment(s, 2000)).toEqual([]);
  });
});

describe("patientOwesNow", () => {
  it("only for unpaid and partially paid", () => {
    expect(patientOwesNow("unpaid")).toBe(true);
    expect(patientOwesNow("partially_paid")).toBe(true);
    expect(patientOwesNow("awaiting_insurance")).toBe(false);
    expect(patientOwesNow("paid")).toBe(false);
    expect(patientOwesNow("draft")).toBe(false);
  });
});
