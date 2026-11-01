import { describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES, canTransition, isTerminal } from "./appointment-status";
import { CLINICAL_REVIEW_REQUIRED, sortWorklist, validateCriticalFlag, type WorklistItem } from "./clinical-priority";
import { consentState, validatePatient } from "./patient";
import { canAccess, HOME_BY_ROLE, navFor, resolveDestination, ROLES, safeNextPath } from "./routing";

describe("appointment status machine", () => {
  it("allows the normal visit path", () => {
    expect(canTransition("scheduled", "arrived")).toBe(true);
    expect(canTransition("arrived", "in_room")).toBe(true);
    expect(canTransition("in_room", "completed")).toBe(true);
  });
  it("blocks skipping or reopening", () => {
    expect(canTransition("scheduled", "completed")).toBe(false);
    expect(canTransition("completed", "scheduled")).toBe(false);
    expect(canTransition("cancelled", "arrived")).toBe(false);
  });
  it("allows undoing an accidental check-in or no-show", () => {
    expect(canTransition("arrived", "scheduled")).toBe(true);
    expect(canTransition("no_show", "scheduled")).toBe(true);
  });
  it("treats same-state as a no-op", () => {
    for (const s of APPOINTMENT_STATUSES) expect(canTransition(s, s)).toBe(true);
  });
  it("has completed and cancelled as terminal", () => {
    expect(APPOINTMENT_STATUSES.filter(isTerminal)).toEqual(["completed", "cancelled"]);
  });
});

describe("doctor worklist (CLINICAL PLACEHOLDER)", () => {
  it("is flagged for clinician review", () => {
    expect(CLINICAL_REVIEW_REQUIRED).toBe(true);
  });
  const at = (h: number) => new Date(Date.UTC(2026, 10, 2, h));
  const item = (over: Partial<WorklistItem>): WorklistItem => ({
    appointmentId: "a",
    consultationId: null,
    patientName: "x",
    startsAt: at(9),
    appointmentStatus: "scheduled",
    unsignedNote: false,
    critical: false,
    criticalReason: null,
    carriedOver: false,
    ...over,
  });

  it("pulls critical, then unsigned notes, to the top", () => {
    const sorted = sortWorklist([
      item({ patientName: "routine-9", startsAt: at(9) }),
      item({ patientName: "done", appointmentStatus: "completed", startsAt: at(8) }),
      item({ patientName: "unsigned-11", unsignedNote: true, startsAt: at(11) }),
      item({ patientName: "critical-15", critical: true, criticalReason: "K+ 6.8", startsAt: at(15) }),
      item({ patientName: "unsigned-yesterday", unsignedNote: true, carriedOver: true, startsAt: null }),
      item({ patientName: "in-room-10", appointmentStatus: "in_room", startsAt: at(10) }),
    ]);
    expect(sorted.map((s) => s.patientName)).toEqual([
      "critical-15",
      "unsigned-yesterday",
      "unsigned-11",
      "in-room-10",
      "routine-9",
      "done",
    ]);
    expect(sorted[0]?.bucket).toBe("critical");
  });

  it("requires a reason to mark critical", () => {
    expect(validateCriticalFlag(true, "  ")).toHaveLength(1);
    expect(validateCriticalFlag(true, "Chest pain")).toEqual([]);
    expect(validateCriticalFlag(false, null)).toEqual([]);
  });
});

describe("routing", () => {
  it("gives each role its own home", () => {
    expect(new Set(Object.values(HOME_BY_ROLE)).size).toBe(ROLES.length);
    for (const role of ROLES) expect(canAccess(role, HOME_BY_ROLE[role])).toBe(true);
  });
  it("keeps roles out of each other's homes", () => {
    expect(canAccess("patient", "/reception")).toBe(false);
    expect(canAccess("receptionist", "/doctor")).toBe(false);
    expect(canAccess("doctor", "/billing")).toBe(false);
    expect(canAccess("lab", "/patients")).toBe(false);
    expect(canAccess("pharmacist", "/admin")).toBe(false);
  });
  it("uses the longest matching prefix", () => {
    expect(canAccess("doctor", "/patients/123")).toBe(true);
    expect(canAccess("doctor", "/patients/new")).toBe(false);
    expect(canAccess("receptionist", "/patients/new")).toBe(true);
  });
  it("does not match on partial segments", () => {
    expect(canAccess("receptionist", "/receptionist-secret")).toBe(false);
    expect(canAccess("admin", "/administrator")).toBe(false);
  });
  it("denies unknown routes by default", () => {
    for (const role of ROLES) expect(canAccess(role, "/unknown")).toBe(false);
  });
  it("redirects to home when a path is not allowed", () => {
    expect(resolveDestination("patient", "/billing")).toBe("/me");
    expect(resolveDestination("doctor", "/")).toBe("/doctor");
    expect(resolveDestination("receptionist", "/billing/abc")).toBe("/billing/abc");
  });
  it("only allows same-site relative redirects", () => {
    expect(safeNextPath("/patients")).toBe("/patients");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
  it("only puts reachable links in each role's nav", () => {
    for (const role of ROLES) for (const item of navFor(role)) expect(canAccess(role, item.href), `${role} ${item.href}`).toBe(true);
  });
});

describe("patient validation and consent", () => {
  const ok = { givenName: "Amal", familyName: "Haddad", dateOfBirth: "1984-05-12", sexAtBirth: "female" };
  it("accepts a valid patient", () => {
    expect(validatePatient(ok, "2026-11-01")).toEqual({});
  });
  it("reports each field problem", () => {
    const errors = validatePatient(
      { givenName: " ", familyName: "", dateOfBirth: "2030-01-01", sexAtBirth: "x", phone: "abc", email: "no-at" },
      "2026-11-01",
    );
    expect(Object.keys(errors).sort()).toEqual(["dateOfBirth", "email", "familyName", "givenName", "phone", "sexAtBirth"]);
  });
  it("rejects impossible dates of birth", () => {
    expect(validatePatient({ ...ok, dateOfBirth: "1984-02-30" }, "2026-11-01").dateOfBirth).toBeDefined();
  });
  it("derives consent state", () => {
    const full = { consentTreatmentAt: "2026-01-01", consentDataProcessingAt: "2026-01-01", consentCommunication: false, consentVersion: "v2" };
    expect(consentState(full, "v2")).toBe("complete");
    expect(consentState(full, "v3")).toBe("outdated");
    expect(consentState({ ...full, consentDataProcessingAt: null }, "v2")).toBe("missing");
  });
});
