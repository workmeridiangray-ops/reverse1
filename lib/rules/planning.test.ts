import { describe, expect, it } from "vitest";
import { daysBetween, inLookahead, slipDays, validateActivity, wouldCycle } from "./schedule";
import { SubcontractError, subBill, woHeadroom } from "./subcontract";

const a = (id: string, start: string, end: string, deps: string[] = []) => ({ id, start, end, deps });
describe("schedule", () => {
  const all = [a("A", "2026-01-01", "2026-01-10"), a("B", "2026-01-11", "2026-01-20", ["A"])];
  it("accepts a valid finish-to-start chain", () => expect(validateActivity(all[1]!, all)).toEqual([]));
  it("rejects starting before the predecessor finishes", () => expect(validateActivity(a("B", "2026-01-05", "2026-01-20", ["A"]), all).join()).toMatch(/predecessor finishes/));
  it("rejects finish before start and self dependency", () => {
    expect(validateActivity(a("C", "2026-02-02", "2026-02-01"), all)[0]).toMatch(/Finish date/);
    expect(validateActivity(a("C", "2026-02-01", "2026-02-02", ["C"]), all).join()).toMatch(/itself/);
  });
  it("detects loops", () => {
    expect(wouldCycle(all, "A", ["B"])).toBe(true);
    expect(wouldCycle(all, "C", ["B"])).toBe(false);
  });
  it("lookahead and slip", () => {
    expect(inLookahead(a("x", "2026-03-01", "2026-03-05"), "2026-02-20")).toBe(true);
    expect(inLookahead(a("x", "2026-06-01", "2026-06-05"), "2026-02-20")).toBe(false);
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(slipDays({ end: "2026-02-10", baseEnd: "2026-02-01" })).toBe(9);
    expect(slipDays({ end: "2026-02-10", baseEnd: null })).toBe(0);
  });
});
describe("subcontract bill", () => {
  const line = { id: "l1", code: "1.01", rateMinor: 8000, orderedMilli: 500_000, approvedMilli: 300_000, billedMilli: 100_000 };
  it("bills only approved, unbilled quantity", () => {
    const b = subBill([line], 500, 10_000);
    expect(b.grossMinor).toBe(1_600_000); // 200 m3 × ₹80
    expect(b.retentionMinor).toBe(80_000);
    expect(b.netMinor).toBe(1_600_000 - 80_000 - 10_000);
  });
  it("cannot bill the same work twice", () => {
    expect(() => subBill([{ ...line, approvedMilli: 100_000 }], 500, 0)).toThrow(SubcontractError);
  });
  it("rejects over-order approval and excessive deductions", () => {
    expect(() => subBill([{ ...line, approvedMilli: 600_000 }], 0, 0)).toThrow(/exceeds the work-order/);
    expect(() => subBill([line], 500, 9_999_999)).toThrow(/Deductions/);
  });
  it("headroom against the BOQ", () => expect(woHeadroom(1_000_000, 700_000)).toBe(300_000));
});
