import { describe, expect, it } from "vitest";
import { describeSummary, formatMinutes, formatPercent, formatProportion, MIN_SAMPLE, proportion, quantile, summarizeDurations, tenthsOfPercent } from "./analytics";
import { validateMyDetails, validateRequest } from "./portal";

const seq = (n: number, f: (i: number) => number = (i) => i + 1) => Array.from({ length: n }, (_, i) => f(i));

describe("quantile (linear interpolation, same as Postgres percentile_cont)", () => {
  it("matches known values", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile(seq(11), 0.9)).toBe(10);
    expect(quantile([10, 20], 0.9)).toBeCloseTo(19);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });
  it("rejects empty input and bad quantiles", () => {
    expect(() => quantile([], 0.5)).toThrow();
    expect(() => quantile([1], 1.5)).toThrow();
  });
});

describe("summarizeDurations: medians, never means", () => {
  it("one very long wait barely moves the median or p90 but would wreck a mean", () => {
    const waits = [...seq(19, () => 10), 180]; // 19 patients at 10 min, one at 3 hours
    const s = summarizeDurations(waits);
    expect(s).toMatchObject({ n: 20, status: "ok", median: 10, fastest: 10, slowest: 180 });
    expect(s.p90).toBe(10);
    const mean = waits.reduce((a, b) => a + b, 0) / waits.length; // 18.5: the number we refuse to publish
    expect(mean).toBeGreaterThan(s.median! * 1.8);
  });
  it("says 'too few to judge' under 10 observations and publishes no numbers", () => {
    const s = summarizeDurations(seq(MIN_SAMPLE - 1));
    expect(s).toMatchObject({ n: 9, status: "too_few", median: null, p90: null, fastest: null, slowest: null });
    expect(describeSummary(s)).toBe("Too few to judge (9 observations, need 10)");
    expect(summarizeDurations(seq(MIN_SAMPLE)).status).toBe("ok");
  });
  it("distinguishes 'no data' from 'too few'", () => {
    expect(summarizeDurations([]).status).toBe("none");
    expect(describeSummary(summarizeDurations([]))).toBe("No data in this period");
  });
  it("counts, rather than silently drops, unusable rows", () => {
    const s = summarizeDurations([...seq(10), null, undefined, -5, Number.NaN, Number.POSITIVE_INFINITY]);
    expect(s).toMatchObject({ n: 10, excluded: 5, status: "ok" });
  });
  it("rows that are excluded do not count toward the minimum", () => {
    expect(summarizeDurations([...seq(9), null]).status).toBe("too_few");
  });
  it("is insensitive to input order", () => {
    expect(summarizeDurations(seq(15).reverse())).toEqual(summarizeDurations(seq(15)));
  });
  it("describes a result in words", () => {
    expect(describeSummary(summarizeDurations(seq(20, (i) => (i + 1) * 3)))).toBe("Median 32 min, 90% within 54 min");
  });
});

describe("proportion: never a percentage without its denominator", () => {
  it("formats 'x of n (p%)'", () => {
    expect(formatProportion(proportion(12, 40))).toBe("12 of 40 (30.0%)");
    expect(formatProportion(proportion(1, 3, 30))).toBe("1 of 3 (33.3%)");
    expect(formatProportion(proportion(2, 3, 30))).toBe("2 of 3 (66.7%)"); // half-up rounding
  });
  it("hides the percentage under the minimum sample, but still shows both counts", () => {
    const p = proportion(3, 7);
    expect(p).toMatchObject({ status: "too_few", tenths: null });
    expect(formatProportion(p)).toBe("3 of 7: too few to judge");
    expect(formatProportion(p)).not.toContain("%");
  });
  it("handles an empty denominator without dividing by zero", () => {
    expect(proportion(0, 0)).toMatchObject({ status: "none", tenths: null });
    expect(formatProportion(proportion(0, 0))).toBe("No data in this period");
  });
  it("judges money by the NUMBER OF INVOICES, not the amount", () => {
    const few = proportion(900_00, 1_000_00, 4);
    expect(few.status).toBe("too_few");
    const many = proportion(900_00, 1_000_00, 25);
    expect(many.tenths).toBe(900);
    expect(formatProportion(many, (n) => `£${(n / 100).toFixed(2)}`)).toBe("£900.00 of £1000.00 (90.0%)");
  });
  it("uses integer arithmetic: exact even for enormous totals", () => {
    expect(tenthsOfPercent(1, 3)).toBe(333);
    expect(tenthsOfPercent(0, 5)).toBe(0);
    expect(tenthsOfPercent(5, 5)).toBe(1000);
    expect(tenthsOfPercent(4_503_599_627_370_495, 9_007_199_254_740_991)).toBe(500);
    expect(formatPercent(1000)).toBe("100.0%");
    expect(formatPercent(5)).toBe("0.5%");
  });
  it("rejects impossible inputs", () => {
    expect(() => tenthsOfPercent(5, 3)).toThrow();
    expect(() => tenthsOfPercent(-1, 3)).toThrow();
    expect(() => tenthsOfPercent(1.5, 3)).toThrow();
    expect(() => tenthsOfPercent(1, 0)).toThrow();
  });
});

describe("formatMinutes", () => {
  it.each([[0, "0 min"], [9.4, "9 min"], [59.6, "1 h"], [60, "1 h"], [65, "1 h 5 min"], [190, "3 h 10 min"]])("%f -> %s", (m, text) => {
    expect(formatMinutes(m)).toBe(text);
  });
});

describe("portal request rules", () => {
  it("needs a time preference and a reason", () => {
    expect(validateRequest({ preferred: "Tuesday mornings", reason: "Back pain" }, 0)).toEqual({});
    expect(Object.keys(validateRequest({ preferred: " ", reason: "" }, 0)).sort()).toEqual(["preferred", "reason"]);
  });
  it("limits how many requests can be waiting", () => {
    expect(validateRequest({ preferred: "any", reason: "x" }, 3).form).toMatch(/already have 3/);
    expect(validateRequest({ preferred: "any", reason: "x" }, 2)).toEqual({});
  });
  it("validates the patient's own contact details", () => {
    expect(validateMyDetails({ phone: "+44 7700 900101", email: "a@b.co" })).toEqual({});
    expect(Object.keys(validateMyDetails({ phone: "abc", email: "nope" })).sort()).toEqual(["email", "phone"]);
    expect(validateMyDetails({ phone: "", email: "" })).toEqual({}); // both optional
  });
});
