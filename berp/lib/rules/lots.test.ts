import { describe, expect, test } from "vitest";
import { parseLots, totalQty } from "./lots";

describe("lot parsing", () => {
  test("batch lines: lot, qty, optional expiry", () => {
    const r = parseLots("L1, 4, 2027-03-31\nL2, 2.5", "batch");
    expect(r.errors).toEqual([]);
    expect(r.lots).toEqual([{ code: "L1", qty: 4, expiry: "2027-03-31" }, { code: "L2", qty: 2.5 }]);
    expect(totalQty(r.lots)).toBe(6.5);
  });
  test("batch errors name the line", () => {
    const r = parseLots("L1\nL2, 0\nL3, 1, 2027-02-30\nL3, 1\nL4, 1.2345", "batch");
    expect(r.errors.join("|")).toMatch(/line 1: use.*line 2: quantity.*line 3: expiry.*line 4: lot "L3" is listed twice.*line 5: quantity/s);
  });
  test("serials: one per line, several per line, optional expiry, duplicates refused", () => {
    expect(parseLots("SN1\nSN2, SN3 SN4", "serial").lots.map((l) => l.code)).toEqual(["SN1", "SN2", "SN3", "SN4"]);
    expect(parseLots("SN1, 2027-01-01", "serial").lots).toEqual([{ code: "SN1", qty: 1, expiry: "2027-01-01" }]);
    expect(parseLots("SN1\nsn1", "serial").errors[0]).toMatch(/listed twice/);
    expect(parseLots("SN1, 2027-13-45", "serial").errors[0]).toMatch(/real date/); // a date-shaped field is never mistaken for a serial
  });
  test("untracked items yield nothing; control characters are refused", () => {
    expect(parseLots("whatever", "none")).toEqual({ lots: [], errors: [] });
    expect(parseLots("A\u0007B, 1", "batch").errors[0]).toMatch(/not a valid/);
  });
});
