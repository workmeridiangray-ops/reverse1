import { describe, expect, it } from "vitest";
import {
  ageInYears,
  dayBounds,
  formatClock,
  localDateKey,
  parseDateKey,
  parseLocalDateTime,
  toLocalDateTimeInput,
  zoneOffsetMinutes,
} from "./time";

describe("clinic-local days", () => {
  it("uses the clinic's zone, not UTC, for 'today'", () => {
    const instant = new Date("2026-11-01T22:30:00Z");
    expect(localDateKey(instant, "UTC")).toBe("2026-11-01");
    expect(localDateKey(instant, "Asia/Dubai")).toBe("2026-11-02"); // UTC+4
    expect(localDateKey(instant, "America/New_York")).toBe("2026-11-01");
  });

  it("computes day bounds in a fixed-offset zone", () => {
    const { start, end } = dayBounds("2026-11-02", "Asia/Dubai");
    expect(start.toISOString()).toBe("2026-11-01T20:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T20:00:00.000Z");
  });

  it("handles a 25-hour DST day (New York fall back, 2026-11-01)", () => {
    const { start, end } = dayBounds("2026-11-01", "America/New_York");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it("handles a 23-hour DST day (London spring forward)", () => {
    const { start, end } = dayBounds("2026-03-29", "Europe/London");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it("reports zone offsets", () => {
    expect(zoneOffsetMinutes(new Date("2026-06-01T00:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(new Date("2026-06-01T00:00:00Z"), "UTC")).toBe(0);
  });
});

describe("parsing", () => {
  it("rejects impossible dates", () => {
    expect(() => parseDateKey("2026-02-30")).toThrow();
    expect(() => parseDateKey("2026-13-01")).toThrow();
    expect(() => parseDateKey("01/02/2026")).toThrow();
    expect(parseDateKey("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it("round-trips datetime-local inputs in the clinic zone", () => {
    const d = parseLocalDateTime("2026-11-02T09:30", "Asia/Dubai");
    expect(d.toISOString()).toBe("2026-11-02T05:30:00.000Z");
    expect(toLocalDateTimeInput(d, "Asia/Dubai")).toBe("2026-11-02T09:30");
    expect(formatClock(d, "Asia/Dubai")).toBe("09:30");
  });

  it("rejects malformed datetime-local inputs", () => {
    expect(() => parseLocalDateTime("2026-11-02 09:30", "UTC")).toThrow();
    expect(() => parseLocalDateTime("2026-11-02T25:00", "UTC")).toThrow();
  });
});

describe("ageInYears", () => {
  it("counts whole years, birthday-aware", () => {
    const on = new Date("2026-11-01T12:00:00Z");
    expect(ageInYears("1990-11-01", on, "UTC")).toBe(36);
    expect(ageInYears("1990-11-02", on, "UTC")).toBe(35);
    expect(ageInYears("2026-01-01", on, "UTC")).toBe(0);
  });
});
