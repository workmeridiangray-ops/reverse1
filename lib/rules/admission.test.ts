import { describe, expect, it } from "vitest";
import { bedState, canAllocate, depositProblem, dischargeBlockers, requiredClearances } from "./admission";

const base = { status: "admitted", type: "elective", emergencyNeedsFinance: false, authorised: true, hasSummary: true,
  clearances: ["finance", "pharmacy", "nursing"] } as const;

describe("requiredClearances", () => {
  it("elective needs all three", () => expect(requiredClearances("elective", false)).toEqual(["finance", "pharmacy", "nursing"]));
  it("emergency skips finance by default (hospital-defined)", () => expect(requiredClearances("emergency", false)).toEqual(["pharmacy", "nursing"]));
  it("emergency needs finance if the hospital says so", () => expect(requiredClearances("emergency", true)).toHaveLength(3));
});

describe("dischargeBlockers", () => {
  it("nothing outstanding when everything is done", () => expect(dischargeBlockers({ ...base, clearances: [...base.clearances] })).toEqual([]));
  it("lists every missing step", () => {
    const b = dischargeBlockers({ ...base, authorised: false, hasSummary: false, clearances: [] });
    expect(b).toHaveLength(5);
    expect(b[0]).toBe("Discharge has not been authorised by a doctor");
  });
  it("an emergency is not blocked by missing finance clearance", () => {
    expect(dischargeBlockers({ ...base, type: "emergency", clearances: ["pharmacy", "nursing"] })).toEqual([]);
  });
  it("a requested or discharged admission cannot be discharged", () => {
    expect(dischargeBlockers({ ...base, status: "requested", clearances: [...base.clearances] })).toContain("Patient is not currently admitted");
    expect(dischargeBlockers({ ...base, status: "discharged", clearances: [...base.clearances] })).toContain("Patient is not currently admitted");
  });
});

describe("depositProblem", () => {
  it("elective needs a reference when policy requires it", () => expect(depositProblem("elective", true, "  ")).not.toBeNull());
  it("emergency never does", () => expect(depositProblem("emergency", true, "")).toBeNull());
  it("elective is fine when policy is off", () => expect(depositProblem("elective", false, "")).toBeNull());
});

describe("bedState", () => {
  it("only an unoccupied clean bed in service can be allocated", () => {
    expect(canAllocate(bedState({ outOfService: false, housekeeping: "clean", occupied: false }))).toBe(true);
    expect(canAllocate(bedState({ outOfService: false, housekeeping: "dirty", occupied: false }))).toBe(false);
    expect(canAllocate(bedState({ outOfService: false, housekeeping: "cleaning", occupied: false }))).toBe(false);
    expect(canAllocate(bedState({ outOfService: false, housekeeping: "clean", occupied: true }))).toBe(false);
    expect(canAllocate(bedState({ outOfService: true, housekeeping: "clean", occupied: false }))).toBe(false);
  });
  it("out of service wins over everything", () => expect(bedState({ outOfService: true, housekeeping: "dirty", occupied: true })).toBe("out_of_service"));
});
