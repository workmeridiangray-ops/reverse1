import { describe, expect, it } from "vitest";
import {
  addDays, batchState, coverDaysFor, daysBetween, expiresMidCourse, expiryBand, flagsFor, noteReasons, planDispense, suggestSupply,
  type StockBatch, unitsPerDose, validateAllocations, validateNote,
} from "./dispensing";
import { needsWriteOff, summarizeStock } from "./stock";

const TODAY = "2026-11-11";
const b = (id: string, expiryDays: number, onHand: number, status: StockBatch["status"] = "available"): StockBatch => ({
  id, batchNumber: id.toUpperCase(), expiryDate: addDays(TODAY, expiryDays), onHand, status,
});

describe("dates", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-11-11", 20)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-11", "2026-12-11")).toBe(30);
  });
});

describe("expires mid-course", () => {
  it("a batch in date today but expiring 20 days into a 30-day course is flagged", () => {
    expect(expiresMidCourse(addDays(TODAY, 20), TODAY, 30)).toBe(true);
  });
  it("is fine when the batch outlasts the course", () => {
    expect(expiresMidCourse(addDays(TODAY, 200), TODAY, 30)).toBe(false);
  });
  it("expiry is inclusive: the last day of the course may be the expiry date", () => {
    // 30-day course starting today: day 1 is today, day 30 is today+29.
    expect(expiresMidCourse(addDays(TODAY, 29), TODAY, 30)).toBe(false);
    expect(expiresMidCourse(addDays(TODAY, 28), TODAY, 30)).toBe(true);
  });
  it("an already-expired batch is 'expired', not 'mid-course'", () => {
    expect(expiresMidCourse(addDays(TODAY, -1), TODAY, 30)).toBe(false);
  });
  it("gives no verdict when the course length is unknown", () => {
    expect(expiresMidCourse(addDays(TODAY, 1), TODAY, null)).toBe(false);
    expect(expiresMidCourse(addDays(TODAY, 1), TODAY, 0)).toBe(false);
  });
  it("a one-day supply is never mid-course if in date", () => {
    expect(expiresMidCourse(TODAY, TODAY, 1)).toBe(false);
  });
});

describe("batch state and bands", () => {
  it("classifies batches", () => {
    expect(batchState(b("a", 5, 10), TODAY)).toBe("usable");
    expect(batchState(b("a", 0, 10), TODAY)).toBe("usable"); // expires today: still usable today
    expect(batchState(b("a", -1, 10), TODAY)).toBe("expired");
    expect(batchState(b("a", 5, 0), TODAY)).toBe("empty");
    expect(batchState(b("a", 5, 10, "quarantined"), TODAY)).toBe("quarantined");
    expect(batchState(b("a", -9, 10, "recalled"), TODAY)).toBe("recalled"); // recalled wins over expired
  });
  it("expiry bands", () => {
    expect(expiryBand(addDays(TODAY, -1), TODAY)).toBe("expired");
    expect(expiryBand(addDays(TODAY, 30), TODAY)).toBe("soon");
    expect(expiryBand(addDays(TODAY, 31), TODAY)).toBe("ok");
  });
});

describe("planDispense: first-expiry-first-out", () => {
  const stock = [b("late", 200, 200), b("early", 20, 100), b("mid", 90, 50)];
  it("takes the earliest-expiry batch first and spills into the next", () => {
    const p = planDispense({ batches: stock, quantity: 130, today: TODAY, coverDays: null });
    expect(p.allocations.map((a) => [a.batchId, a.quantity])).toEqual([["early", 100], ["mid", 30]]);
    expect(p.shortfall).toBe(0);
    expect(p.flags).toEqual({ midCourse: false, fefoSkipped: false }); // no course length known
  });
  it("flags the early batch when it expires partway through a 30-day course", () => {
    const p = planDispense({ batches: stock, quantity: 60, today: TODAY, coverDays: 30 });
    expect(p.allocations).toEqual([expect.objectContaining({ batchId: "early", quantity: 60, midCourse: true })]);
    expect(p.flags).toEqual({ midCourse: true, fefoSkipped: false });
  });
  it("'prefer longer-dated' uses the safe batch, which is then a deliberate FEFO departure", () => {
    const p = planDispense({ batches: stock, quantity: 40, today: TODAY, coverDays: 30, avoidMidCourse: true });
    expect(p.allocations.map((a) => a.batchId)).toEqual(["mid"]); // 90 days: outlasts the course; 'late' is further out
    expect(p.flags).toEqual({ midCourse: false, fefoSkipped: true }); // 'early' still had stock
  });
  it("uses a mid-course batch last if the longer-dated stock isn't enough", () => {
    const p = planDispense({ batches: stock, quantity: 280, today: TODAY, coverDays: 30, avoidMidCourse: true });
    expect(p.allocations.map((a) => [a.batchId, a.quantity])).toEqual([["mid", 50], ["late", 200], ["early", 30]]);
    expect(p.flags.midCourse).toBe(true);
  });
  it("never uses expired, quarantined, recalled or empty batches", () => {
    const bad = [b("old", -3, 99), b("q", 50, 99, "quarantined"), b("r", 60, 99, "recalled"), b("e", 70, 0), b("ok", 80, 10)];
    const p = planDispense({ batches: bad, quantity: 20, today: TODAY, coverDays: null });
    expect(p.allocations.map((a) => [a.batchId, a.quantity])).toEqual([["ok", 10]]);
    expect(p.shortfall).toBe(10);
  });
  it("breaks expiry ties deterministically", () => {
    const tie = [b("b2", 50, 5), b("b1", 50, 5)];
    expect(planDispense({ batches: tie, quantity: 5, today: TODAY, coverDays: null }).allocations[0]?.batchId).toBe("b1");
  });
  it("rejects a non-positive or fractional quantity", () => {
    expect(() => planDispense({ batches: stock, quantity: 0, today: TODAY, coverDays: null })).toThrow();
    expect(() => planDispense({ batches: stock, quantity: 1.5, today: TODAY, coverDays: null })).toThrow();
  });
});

describe("flagsFor hand-picked allocations", () => {
  const stock = [b("early", 20, 100), b("late", 200, 200)];
  it("detects skipping an earlier batch that still has stock", () => {
    expect(flagsFor([{ batchId: "late", quantity: 10 }], stock, TODAY, null).fefoSkipped).toBe(true);
  });
  it("does not call it skipping when the earlier batch is used up", () => {
    expect(flagsFor([{ batchId: "early", quantity: 100 }, { batchId: "late", quantity: 5 }], stock, TODAY, null).fefoSkipped).toBe(false);
    expect(flagsFor([{ batchId: "early", quantity: 99 }, { batchId: "late", quantity: 5 }], stock, TODAY, null).fefoSkipped).toBe(true);
  });
  it("ignores earlier batches that aren't usable", () => {
    const s = [b("dead", -2, 50), b("quar", 5, 50, "quarantined"), b("late", 200, 200)];
    expect(flagsFor([{ batchId: "late", quantity: 10 }], s, TODAY, null).fefoSkipped).toBe(false);
  });
});

describe("validateAllocations", () => {
  const stock = [b("ok", 100, 10), b("old", -1, 10), b("q", 100, 10, "quarantined"), b("r", 100, 10, "recalled")];
  it("accepts a valid allocation", () => expect(validateAllocations([{ batchId: "ok", quantity: 10 }], stock, TODAY)).toEqual([]));
  it("refuses every unsafe batch and over-drawing", () => {
    expect(validateAllocations([{ batchId: "old", quantity: 1 }], stock, TODAY)).toEqual(["Batch OLD has expired."]);
    expect(validateAllocations([{ batchId: "q", quantity: 1 }], stock, TODAY)).toEqual(["Batch Q is quarantined."]);
    expect(validateAllocations([{ batchId: "r", quantity: 1 }], stock, TODAY)).toEqual(["Batch R has been recalled."]);
    expect(validateAllocations([{ batchId: "ok", quantity: 11 }], stock, TODAY)).toEqual(["Only 10 left in batch OK."]);
    expect(validateAllocations([{ batchId: "zz", quantity: 1 }], stock, TODAY)).toHaveLength(1);
    expect(validateAllocations([{ batchId: "ok", quantity: 0 }], stock, TODAY)).toHaveLength(1);
    expect(validateAllocations([{ batchId: "ok", quantity: 2 }, { batchId: "ok", quantity: 2 }], stock, TODAY)).toContain("Batch OK is listed twice.");
    expect(validateAllocations([], stock, TODAY)).toEqual(["Choose at least one batch."]);
  });
});

describe("notes", () => {
  it("is required for any flag, and says why", () => {
    const reasons = noteReasons({ midCourse: true, fefoSkipped: true }, true);
    expect(reasons).toHaveLength(3);
    expect(validateNote(reasons, "short")).toMatch(/because a batch expires/);
    expect(validateNote(reasons, "Longer-dated batch used; patient counselled.")).toBeNull();
    expect(validateNote(noteReasons({ midCourse: false, fefoSkipped: false }, false), "")).toBeNull();
  });
});

describe("suggested supply", () => {
  it("works out a quantity when the dose is a count", () => {
    expect(suggestSupply("2 tablets", "twice daily", 7)).toEqual({ quantity: 28, coverDays: 7 });
    expect(suggestSupply("1 capsule", "three times daily", 10)).toEqual({ quantity: 30, coverDays: 10 });
    expect(suggestSupply("1 tab", "every 8 hours", 30)).toEqual({ quantity: 90, coverDays: 30 });
    expect(suggestSupply("1 tablet", "weekly", 10)).toEqual({ quantity: 2, coverDays: 10 });
    expect(suggestSupply("1 tablet", "once only", null)).toEqual({ quantity: 1, coverDays: 1 });
  });
  it("does not guess from a strength like 500 mg, an unknown frequency or a missing duration", () => {
    expect(unitsPerDose("500 mg")).toBeNull();
    expect(suggestSupply("500 mg", "twice daily", 7)).toBeNull();
    expect(suggestSupply("1 tablet", "as needed", 7)).toBeNull();
    expect(suggestSupply("1 tablet", "twice daily", null)).toBeNull();
  });
  it("works out how long a typed quantity lasts when it can", () => {
    expect(coverDaysFor(60, "200 mg", "twice daily", 30)).toBe(30);
    expect(coverDaysFor(60, "1 tablet", "twice daily", null)).toBe(30);
    expect(coverDaysFor(60, "200 mg", "twice daily", null)).toBeNull();
  });
});

describe("stock summary", () => {
  const stock = [b("a", 10, 40), b("b", 200, 100), b("x", -5, 30), b("q", 50, 20, "quarantined")];
  it("counts only usable stock toward availability", () => {
    expect(summarizeStock(stock, 50, TODAY)).toEqual({
      usable: 140, expired: 30, quarantined: 20, recalled: 0, expiringSoon: 40, outOfStock: false, belowReorder: false, nextExpiry: addDays(TODAY, 10),
    });
  });
  it("flags low and out-of-stock: expired units don't count", () => {
    expect(summarizeStock([b("x", -5, 500)], 50, TODAY)).toMatchObject({ usable: 0, outOfStock: true, belowReorder: true, nextExpiry: null });
    expect(summarizeStock(stock, 140, TODAY).belowReorder).toBe(true);
  });
  it("expired stock needs writing off", () => {
    expect(needsWriteOff(b("x", -1, 5), TODAY)).toBe(true);
    expect(needsWriteOff(b("x", -1, 0), TODAY)).toBe(false);
    expect(needsWriteOff(b("x", 0, 5), TODAY)).toBe(false);
  });
});
