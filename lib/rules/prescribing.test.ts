import { describe, expect, it } from "vitest";
import { parseDuration, validatePrescription } from "./prescribing";

const ok = { drugName: "Amoxicillin", dose: "500 mg", route: "oral", frequency: "three times daily", durationDays: "7" };

describe("validatePrescription", () => {
  it("accepts a complete prescription, with or without a duration", () => {
    expect(validatePrescription(ok)).toEqual({});
    expect(validatePrescription({ ...ok, durationDays: "" })).toEqual({});
    expect(validatePrescription({ ...ok, durationDays: null })).toEqual({});
  });
  it("reports each problem", () => {
    const e = validatePrescription({ drugName: " ", dose: "some", route: "nose", frequency: "", durationDays: "0" });
    expect(Object.keys(e).sort()).toEqual(["dose", "drugName", "durationDays", "frequency", "route"]);
  });
  it("bounds the duration", () => {
    expect(validatePrescription({ ...ok, durationDays: "365" })).toEqual({});
    expect(validatePrescription({ ...ok, durationDays: "366" }).durationDays).toBeDefined();
    expect(validatePrescription({ ...ok, durationDays: "2.5" }).durationDays).toBeDefined();
    expect(validatePrescription({ ...ok, durationDays: "-3" }).durationDays).toBeDefined();
    expect(validatePrescription({ ...ok, durationDays: 7 })).toEqual({});
  });
  it("requires an amount in the dose", () => {
    expect(validatePrescription({ ...ok, dose: "2 puffs" })).toEqual({});
    expect(validatePrescription({ ...ok, dose: "one tablet" }).dose).toBeDefined();
  });
  it("parses duration", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration(" 14 ")).toBe(14);
  });
});
