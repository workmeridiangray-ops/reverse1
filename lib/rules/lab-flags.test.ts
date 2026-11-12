import { describe, expect, it } from "vitest";
import {
  flagResult, flagValue, isCritical, parseResultValue, pickRange, rangesOverlap, validateRange, type ReferenceRange,
} from "./lab-flags";

const r = (over: Partial<ReferenceRange>): ReferenceRange => ({
  id: "r", sex: "any", ageMinYears: 0, ageMaxYears: 200, low: null, high: null, criticalLow: null, criticalHigh: null, reviewed: false, ...over,
});

// Haemoglobin g/dL (placeholder numbers, adults only)
const HB = [
  r({ id: "hb-f", sex: "female", ageMinYears: 18, low: 12.0, high: 15.5, criticalLow: 7.0, criticalHigh: 20 }),
  r({ id: "hb-m", sex: "male", ageMinYears: 18, low: 13.5, high: 17.5, criticalLow: 7.0, criticalHigh: 20 }),
];

describe("range choice comes before comparison", () => {
  it("13 g/dL haemoglobin is normal for a woman and low for a man", () => {
    expect(flagResult(13, HB, "female", 40).flag).toBe("normal");
    expect(flagResult(13, HB, "male", 40).flag).toBe("low");
    expect(flagResult(13, HB, "female", 40).range?.id).toBe("hb-f");
    expect(flagResult(13, HB, "male", 40).range?.id).toBe("hb-m");
  });
  it("never guesses: no range on file means no flag", () => {
    expect(flagResult(13, [], "female", 40)).toEqual({ flag: "unflagged", range: null });
    expect(flagResult(13, HB, "female", 11).flag).toBe("unflagged"); // child: adult ranges only
    expect(flagResult(13, HB, "intersex", 40).flag).toBe("unflagged"); // sex-specific ranges only
    expect(flagResult(13, HB, "unknown", 40).flag).toBe("unflagged");
  });
  it("uses an any-sex range for intersex or unknown", () => {
    const withAny = [...HB, r({ id: "hb-any", ageMinYears: 18, low: 12.5, high: 16 })];
    expect(flagResult(13, withAny, "unknown", 40)).toMatchObject({ flag: "normal", range: { id: "hb-any" } });
    expect(flagResult(13, withAny, "female", 40).range?.id).toBe("hb-f"); // specific beats any
  });
  it("respects age bands: min inclusive, max exclusive", () => {
    const bands = [r({ id: "kid", ageMaxYears: 18, low: 11, high: 14 }), r({ id: "adult", ageMinYears: 18, low: 12, high: 16 })];
    expect(pickRange(bands, "female", 17)?.id).toBe("kid");
    expect(pickRange(bands, "female", 18)?.id).toBe("adult");
    expect(pickRange(bands, "female", -1)).toBeNull();
  });
  it("refuses to choose between overlapping ranges", () => {
    expect(pickRange([r({ id: "a", low: 1, high: 2 }), r({ id: "b", low: 1, high: 3 })], "male", 30)).toBeNull();
  });
});

describe("flagValue", () => {
  const k = r({ low: 3.5, high: 5.1, criticalLow: 2.8, criticalHigh: 6.2 });
  it.each([
    [4.0, "normal"], [3.5, "normal"], [5.1, "normal"],
    [3.4, "low"], [2.8, "low"], [5.2, "high"], [6.2, "high"],
    [2.79, "critical_low"], [6.21, "critical_high"], [6.8, "critical_high"], [0, "critical_low"],
  ] as const)("potassium %f is %s", (v, flag) => {
    expect(flagValue(v, k)).toBe(flag);
  });
  it("handles one-sided ranges", () => {
    expect(flagValue(0.3, r({ high: 0.5 }))).toBe("normal");
    expect(flagValue(0.6, r({ high: 0.5 }))).toBe("high");
    expect(flagValue(1, r({ low: 2 }))).toBe("low");
  });
  it("does not call a value normal when only critical limits exist", () => {
    const onlyCrit = r({ criticalLow: 2, criticalHigh: 9 });
    expect(flagValue(5, onlyCrit)).toBe("unflagged");
    expect(flagValue(1, onlyCrit)).toBe("critical_low");
  });
  it("gives no verdict without a range or for non-numbers", () => {
    expect(flagValue(5, null)).toBe("unflagged");
    expect(flagValue(Number.NaN, k)).toBe("unflagged");
  });
  it("knows which flags are critical", () => {
    expect(isCritical("critical_high")).toBe(true);
    expect(isCritical("high")).toBe(false);
  });
});

describe("range definitions", () => {
  const base = { sex: "any" as const, ageMinYears: 0, ageMaxYears: 100, low: 1, high: 2, criticalLow: 0.5, criticalHigh: 3 };
  it("accepts a sane range", () => expect(validateRange(base)).toEqual([]));
  it("rejects contradictions", () => {
    expect(validateRange({ ...base, low: 3, high: 2 })).toContain("Low must be below high.");
    expect(validateRange({ ...base, criticalLow: 1.5 })).toContain("Critical low must not be above low.");
    expect(validateRange({ ...base, criticalHigh: 1.5 })).toContain("Critical high must not be below high.");
    expect(validateRange({ ...base, ageMinYears: 50, ageMaxYears: 50 })[0]).toMatch(/Age range/);
    expect(validateRange({ ...base, low: null, high: null, criticalLow: null, criticalHigh: null })).toContain("Give at least one limit.");
  });
  it("detects overlapping age bands for the same sex", () => {
    expect(rangesOverlap({ sex: "female", ageMinYears: 0, ageMaxYears: 18 }, { sex: "female", ageMinYears: 17, ageMaxYears: 60 })).toBe(true);
    expect(rangesOverlap({ sex: "female", ageMinYears: 0, ageMaxYears: 18 }, { sex: "female", ageMinYears: 18, ageMaxYears: 60 })).toBe(false);
    expect(rangesOverlap({ sex: "female", ageMinYears: 0, ageMaxYears: 60 }, { sex: "male", ageMinYears: 0, ageMaxYears: 60 })).toBe(false);
  });
});

describe("parseResultValue", () => {
  it.each([["6.8", 6.8], [" 12 ", 12], ["0.45", 0.45], ["6,8", 6.8]])("accepts %s", (input, v) => {
    expect(parseResultValue(input)).toEqual({ ok: true, value: v });
  });
  it.each(["", "abc", "<0.5", "-1", "1e3", "1.23456"])("rejects %j", (input) => {
    expect(parseResultValue(input).ok).toBe(false);
  });
});

import { coverageGaps, describeGap, limitsChanged, parseLimit } from "./lab-flags";

describe("coverageGaps: who would get no flag", () => {
  const hb = [
    r({ id: "f", sex: "female", ageMinYears: 18, low: 12, high: 15.5 }),
    r({ id: "m", sex: "male", ageMinYears: 18, low: 13.5, high: 17.5 }),
  ];
  it("reports children and the unknown-sex group when only adult sex-specific ranges exist", () => {
    expect(coverageGaps(hb)).toEqual([
      { who: "female", fromAge: 0, toAge: 17 },
      { who: "male", fromAge: 0, toAge: 17 },
      { who: "other", fromAge: 0, toAge: 120 },
    ]);
  });
  it("an any-sex range closes the gaps it covers", () => {
    const withAny = [...hb, r({ id: "any", ageMinYears: 0, ageMaxYears: 18, low: 11, high: 14 })];
    expect(coverageGaps(withAny)).toEqual([{ who: "other", fromAge: 18, toAge: 120 }]);
  });
  it("a full any-sex range leaves no gap, and no ranges leaves everything uncovered", () => {
    expect(coverageGaps([r({ low: 1, high: 2 })])).toEqual([]);
    expect(coverageGaps([])).toHaveLength(3);
  });
  it("finds a hole in the middle", () => {
    const holey = [r({ id: "a", ageMaxYears: 18, low: 1, high: 2 }), r({ id: "b", ageMinYears: 65, low: 1, high: 3 })];
    expect(coverageGaps(holey).filter((g) => g.who === "male")).toEqual([{ who: "male", fromAge: 18, toAge: 64 }]);
  });
  it("describes a gap in plain words", () => {
    expect(describeGap({ who: "female", fromAge: 0, toAge: 17 })).toBe("Women aged 0 to 17 get no flag");
    expect(describeGap({ who: "other", fromAge: 18, toAge: 120 })).toBe("Patients with sex unknown or intersex aged 18 and over get no flag");
    expect(describeGap({ who: "male", fromAge: 0, toAge: 120 })).toBe("Men of any age get no flag");
  });
});

describe("limitsChanged (when a sign-off must be cleared)", () => {
  const base = { sex: "any" as const, ageMinYears: 0, ageMaxYears: 200, low: 3.5, high: 5.1, criticalLow: 2.8, criticalHigh: 6.2 };
  it("is false for an identical range, true for any limit, age or sex change", () => {
    expect(limitsChanged(base, { ...base })).toBe(false);
    for (const change of [{ low: 3.6 }, { high: 5.2 }, { criticalLow: null }, { criticalHigh: 6.3 }, { ageMinYears: 1 }, { ageMaxYears: 100 }, { sex: "male" as const }]) {
      expect(limitsChanged(base, { ...base, ...change }), JSON.stringify(change)).toBe(true);
    }
  });
});

describe("parseLimit", () => {
  it("blank is no limit; numbers parse; junk is refused", () => {
    expect(parseLimit("")).toEqual({ ok: true, value: null });
    expect(parseLimit(" 5.1 ")).toEqual({ ok: true, value: 5.1 });
    expect(parseLimit("abc").ok).toBe(false);
    expect(parseLimit("-1").ok).toBe(false);
  });
});
