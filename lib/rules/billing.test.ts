import { describe, expect, it } from "vitest";
import { BillingError, collectionState, computeBill, contractValue, maxNewDispute } from "./billing";
import { amountFor, formatPercent, formatQty, parsePercentBp, parseQty, percentOf, QtyError } from "./qty";
import { can, violatesSeparation } from "./permissions";

describe("quantities and rounding", () => {
  it("parses decimals exactly and rejects over-precision", () => {
    expect(parseQty("12.345")).toBe(12345);
    expect(parseQty("1,250")).toBe(1250000);
    expect(() => parseQty("1.2345")).toThrow(QtyError);
    expect(() => parseQty("-1")).toThrow(QtyError);
    expect(() => parseQty("abc")).toThrow(QtyError);
    expect(parsePercentBp("5")).toBe(500);
    expect(parsePercentBp("2.55")).toBe(255);
    expect(formatQty(12345)).toBe("12.345");
    expect(formatQty(1000)).toBe("1");
    expect(formatPercent(250)).toBe("2.5%");
  });
  it("rounds half-up exactly", () => {
    expect(amountFor(1500, 3)).toBe(5); // 1.5 × 0.03 = 0.045 → 5 paise (4.5 → 5)
    expect(amountFor(1499, 3)).toBe(4);
    expect(amountFor(12345, 85000)).toBe(1049325); // 12.345 × 850.00
    expect(percentOf(100000, 500)).toBe(5000);
    expect(percentOf(333, 500)).toBe(17); // 16.65 → 17
  });
});

const terms = { retentionBp: 500, retentionCapBp: 500, advanceRecoveryBp: 1000, advanceMinor: 5_000_000, contractValueMinor: 100_000_000 };
const mk = (over: Partial<Parameters<typeof computeBill>[0][number]> = {}) => ({
  boqItemId: "a", rateMinor: 100_00, contractQtyMilli: 1000_000, prevQtyMilli: 0, claimedQtyMilli: 200_000, certifiedQtyMilli: 200_000, ...over,
});

describe("running bill — worked example", () => {
  // Item: 1000 m³ @ ₹100.00. Bill 1: 200 m³ → ₹20,000.00 gross
  it("bill 1: retention 5% and advance recovery 10% of certified gross", () => {
    const b = computeBill([mk()], terms, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 });
    expect(b.certifiedGrossMinor).toBe(2_000_000);
    expect(b.retentionMinor).toBe(100_000);
    expect(b.advanceRecoveryMinor).toBe(200_000);
    expect(b.netMinor).toBe(1_700_000);
  });
  it("bill 2 deducts previously certified quantity (cumulative, no double billing)", () => {
    const b = computeBill([mk({ prevQtyMilli: 200_000, claimedQtyMilli: 300_000, certifiedQtyMilli: 300_000 })], terms, {
      retentionToDateMinor: 100_000, advanceRecoveredToDateMinor: 200_000,
    });
    expect(b.certifiedGrossMinor).toBe(3_000_000); // only the 300 m³ new work
  });
  it("partial certification: certified < claimed", () => {
    const b = computeBill([mk({ claimedQtyMilli: 200_000, certifiedQtyMilli: 150_000 })], terms, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 });
    expect(b.claimedGrossMinor).toBe(2_000_000);
    expect(b.certifiedGrossMinor).toBe(1_500_000);
    expect(b.retentionMinor).toBe(75_000);
  });
  it("retention stops at the contract cap and advance recovery at the outstanding advance", () => {
    const b = computeBill([mk()], terms, { retentionToDateMinor: 4_950_000, advanceRecoveredToDateMinor: 4_900_000 });
    // cap = 5% of 1,00,00,000.00 = 50,00,000.00 (5_000_000); already 4_950_000 → only 50_000 left
    expect(b.retentionMinor).toBe(50_000);
    expect(b.advanceRecoveryMinor).toBe(100_000); // 5_000_000 − 4_900_000
  });
  it("other deductions need to leave a non-negative net", () => {
    expect(() => computeBill([mk()], terms, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 }, 9_999_999)).toThrow(BillingError);
    const b = computeBill([mk()], terms, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 }, 50_000);
    expect(b.netMinor).toBe(1_650_000);
  });
  it("refuses cumulative quantity above the contract quantity until a variation raises it", () => {
    expect(() => computeBill([mk({ prevQtyMilli: 900_000, claimedQtyMilli: 200_000, certifiedQtyMilli: 200_000 })], terms, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 })).toThrow(/variation/);
    const ok = computeBill([mk({ prevQtyMilli: 900_000, contractQtyMilli: 1_100_000, claimedQtyMilli: 200_000, certifiedQtyMilli: 200_000 })], terms, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 });
    expect(ok.certifiedGrossMinor).toBe(2_000_000);
  });
  it("certified cannot exceed claimed", () => {
    expect(() => computeBill([mk({ claimedQtyMilli: 1000, certifiedQtyMilli: 2000 })], terms, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 })).toThrow(BillingError);
  });
  it("cumulative rounding never drifts: the sum of bills equals the amount of the cumulative quantity", () => {
    const rate = 33_33; // ₹33.33
    let prev = 0, total = 0;
    for (const q of [333, 333, 334, 1, 7]) {
      const b = computeBill([{ boqItemId: "x", rateMinor: rate, contractQtyMilli: 10_000, prevQtyMilli: prev, claimedQtyMilli: q, certifiedQtyMilli: q }], { ...terms, retentionBp: 0, advanceRecoveryBp: 0 }, { retentionToDateMinor: 0, advanceRecoveredToDateMinor: 0 });
      total += b.certifiedGrossMinor; prev += q;
    }
    expect(total).toBe(amountFor(prev, rate));
  });
  it("contract value includes approved variation quantity at original rates", () => {
    expect(contractValue([{ qtyMilli: 1_000_000, approvedDeltaMilli: 100_000, rateMinor: 10_000 }])).toBe(11_000_000);
  });
});

describe("collections", () => {
  it("separates invoiced, collected, disputed", () => {
    const s = collectionState(1_000_000, [300_000, 200_000], [150_000]);
    expect(s).toMatchObject({ collectedMinor: 500_000, outstandingMinor: 500_000, undisputedOutstandingMinor: 350_000, status: "part_paid" });
    expect(collectionState(1000, [1000], []).status).toBe("paid");
    expect(collectionState(1000, [], []).status).toBe("unpaid");
    expect(maxNewDispute(500_000, [150_000])).toBe(350_000);
  });
});

describe("permissions", () => {
  it("enforces the role matrix", () => {
    expect(can("owner", "anything")).toBe(true);
    expect(can("engineer", "measure.record")).toBe(true);
    expect(can("engineer", "measure.verify")).toBe(false);
    expect(can("engineer", "bill.view")).toBe(false);
    expect(can("accounts", "bill.certify")).toBe(false);
    expect(can("client", "bill.certify")).toBe(true);
    expect(can("client", "budget.view")).toBe(false);
    expect(can("viewer", "boq.edit")).toBe(false);
    expect(can("procurement", "po.manage")).toBe(true);
    expect(can("procurement", "bill.view")).toBe(false);
  });
  it("separates preparer and approver", () => {
    expect(violatesSeparation("u1", "u1")).toBe(true);
    expect(violatesSeparation("u1", "u2")).toBe(false);
  });
});
