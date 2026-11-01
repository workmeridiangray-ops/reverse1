import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  currencyExponent,
  formatMoney,
  lineTotal,
  MoneyError,
  parseMajor,
  subtract,
  sum,
  toMajorString,
} from "./money";

describe("integer guard", () => {
  it("rejects floats anywhere in the arithmetic", () => {
    expect(() => add(0.1, 0.2)).toThrow(MoneyError);
    expect(() => subtract(100, 0.5)).toThrow(MoneyError);
    expect(() => sum([1, 2, 3.0000001])).toThrow(MoneyError);
    expect(() => lineTotal(1, 9.99)).toThrow(MoneyError);
  });

  it("rejects NaN, Infinity and unsafe integers", () => {
    expect(() => add(Number.NaN, 1)).toThrow(MoneyError);
    expect(() => add(Number.POSITIVE_INFINITY, 1)).toThrow(MoneyError);
    expect(() => add(Number.MAX_SAFE_INTEGER, 1)).toThrow(/overflow/);
  });

  it("adds and sums exactly where floats would drift", () => {
    expect(add(10, 20)).toBe(30); // 0.10 + 0.20 is exactly 0.30
    expect(sum(Array(1000).fill(1))).toBe(1000);
    expect(sum([])).toBe(0);
  });
});

describe("lineTotal", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineTotal(3, 1999)).toBe(5997);
  });
  it("requires a positive whole quantity and a non-negative price", () => {
    expect(() => lineTotal(0, 100)).toThrow(/Quantity/);
    expect(() => lineTotal(1.5, 100)).toThrow(/Quantity/);
    expect(() => lineTotal(1, -1)).toThrow(/negative/);
  });
  it("allows free items", () => {
    expect(lineTotal(2, 0)).toBe(0);
  });
});

describe("parseMajor", () => {
  it.each([
    ["12.50", "USD", 1250],
    ["12.5", "USD", 1250],
    ["12", "USD", 1200],
    ["0.01", "USD", 1],
    ["1,234.56", "USD", 123456],
    [" 7 ", "USD", 700],
    ["0", "USD", 0],
    ["-3.10", "USD", -310],
    ["1500", "JPY", 1500],
    ["1.234", "KWD", 1234],
    ["0.29", "EUR", 29], // the classic float trap: 0.29 * 100 = 28.999999999999996
    ["1.15", "GBP", 115], // 1.15 * 100 = 114.99999999999999
  ])("parses %s %s to %i", (input, currency, expected) => {
    expect(parseMajor(input, currency)).toBe(expected);
  });

  it.each([["12.345", "USD"], ["1.5", "JPY"], ["abc", "USD"], ["", "USD"], ["1.2.3", "USD"], ["1e3", "USD"]])(
    "rejects %s %s",
    (input, currency) => {
      expect(() => parseMajor(input, currency)).toThrow(MoneyError);
    },
  );

  it("rejects bad currency codes", () => {
    expect(() => currencyExponent("dollars")).toThrow(MoneyError);
  });
});

describe("toMajorString / formatMoney", () => {
  it.each([
    [0, "USD", "0.00"],
    [1, "USD", "0.01"],
    [1250, "USD", "12.50"],
    [-5, "USD", "-0.05"],
    [1500, "JPY", "1500"],
    [1234, "KWD", "1.234"],
  ])("renders %i %s as %s", (amount, currency, expected) => {
    expect(toMajorString(amount, currency)).toBe(expected);
  });

  it("round-trips with parseMajor", () => {
    for (const n of [0, 1, 9, 10, 99, 100, 101, 123456789]) {
      expect(parseMajor(toMajorString(n, "USD"), "USD")).toBe(n);
    }
  });

  it("formats with currency symbols", () => {
    expect(formatMoney(123456, "USD", "en-US")).toBe("$1,234.56");
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
  });

  it("keeps precision beyond float range of cents", () => {
    // 2^53 - 1 cents still prints its exact last digits.
    expect(toMajorString(Number.MAX_SAFE_INTEGER, "USD")).toBe("90071992547409.91");
  });
});

describe("allocate", () => {
  it("splits evenly and gives remainder to the first parts", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("always sums back to the original", () => {
    for (const amount of [0, 1, 7, 99, 1001, 123457]) {
      for (const weights of [[1], [1, 2], [3, 3, 4], [70, 30], [1, 0, 1]]) {
        expect(sum(allocate(amount, weights))).toBe(amount);
      }
    }
  });
  it("respects weights (e.g. 80/20 insurance split)", () => {
    expect(allocate(10001, [80, 20])).toEqual([8001, 2000]);
  });
  it("handles negative amounts", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });
  it("rejects bad weights", () => {
    expect(() => allocate(100, [])).toThrow();
    expect(() => allocate(100, [0, 0])).toThrow();
    expect(() => allocate(100, [0.5, 0.5])).toThrow();
  });
});
