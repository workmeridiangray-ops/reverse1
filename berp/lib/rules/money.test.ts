import { describe, expect, test } from "vitest";
import { allocateOldestFirst, available, formatInr, invoiceStatus, lineNet, lineTax, parseInr, totals, toMilli, withinTolerance } from "./money";

describe("money", () => {
  test("line net and tax round half up", () => {
    expect(lineNet(10, 100000)).toBe(1000000);
    expect(lineNet("2.5", 333)).toBe(833); // 832.5 → 833
    expect(lineNet(3, 100001, 1250)).toBe(262503); // 300003 × 0.875 = 262502.625
    expect(lineTax(833, 1800)).toBe(150); // 149.94
    expect(lineTax(25, 500)).toBe(1); // 1.25
  });
  test("totals add per-line rounding, not rounding of sums", () => {
    const t = totals([{ qty: 1, pricePaise: 333, taxRateBp: 1800 }, { qty: 1, pricePaise: 333, taxRateBp: 1800 }]);
    expect(t).toEqual({ subtotal: 666, tax: 120, total: 786 }); // 60 + 60, not round(119.88)
  });
  test("quantities beyond three decimals or negative are rejected", () => {
    expect(() => toMilli("1.2345")).toThrow();
    expect(() => toMilli("-1")).toThrow();
    expect(() => lineNet(1, 100, 10001)).toThrow();
  });
  test("INR formatting uses lakh grouping and round-trips", () => {
    expect(formatInr(123456789)).toBe("₹12,34,567.89");
    expect(formatInr(5)).toBe("₹0.05");
    expect(formatInr(-100000)).toBe("-₹1,000.00");
    expect(parseInr("₹12,34,567.89")).toBe(123456789);
    expect(() => parseInr("12.345")).toThrow();
    expect(() => parseInr("abc")).toThrow();
  });
  test("tolerance, availability, status, allocation", () => {
    expect(withinTolerance(605000, 600000, 200)).toBe(true);
    expect(withinTolerance(700000, 600000, 200)).toBe(false);
    expect(available({ onHand: 6, reserved: 2 })).toBe(4);
    expect(invoiceStatus(100, 0)).toBe("posted");
    expect(invoiceStatus(100, 40)).toBe("partially_paid");
    expect(invoiceStatus(100, 100)).toBe("paid");
    expect(() => invoiceStatus(100, 101)).toThrow();
    expect(allocateOldestFirst(150, [{ id: "a", balance: 100 }, { id: "b", balance: 100 }])).toEqual({
      allocations: [{ invoiceId: "a", amount: 100 }, { invoiceId: "b", amount: 50 }], unapplied: 0 });
    expect(allocateOldestFirst(500, [{ id: "a", balance: 100 }]).unapplied).toBe(400);
  });
});
