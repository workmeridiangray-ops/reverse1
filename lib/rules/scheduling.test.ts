import { describe, expect, it } from "vitest";
import { hasBlocking, holdsSlot, overlaps, type Slot, validateSlot } from "./scheduling";

const t = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const slot = (over: Partial<Slot> = {}): Slot => ({
  id: "new",
  startsAt: t("09:00"),
  endsAt: t("09:15"),
  doctorId: "dr-a",
  roomId: "room-1",
  patientId: "pt-1",
  status: "scheduled",
  ...over,
});

describe("overlaps (half-open intervals)", () => {
  it("back-to-back slots do not overlap", () => {
    expect(overlaps(slot(), slot({ startsAt: t("09:15"), endsAt: t("09:30") }))).toBe(false);
  });
  it("partial and containing overlaps are detected", () => {
    expect(overlaps(slot(), slot({ startsAt: t("09:10"), endsAt: t("09:20") }))).toBe(true);
    expect(overlaps(slot(), slot({ startsAt: t("08:00"), endsAt: t("10:00") }))).toBe(true);
    expect(overlaps(slot(), slot())).toBe(true);
  });
});

describe("validateSlot", () => {
  it("accepts a free slot", () => {
    expect(validateSlot(slot(), [])).toEqual([]);
  });

  it("rejects end before start and zero-length", () => {
    expect(validateSlot(slot({ endsAt: t("08:59") }), [])[0]?.code).toBe("invalid_range");
    expect(validateSlot(slot({ endsAt: t("09:00") }), [])[0]?.code).toBe("invalid_range");
  });

  it("enforces min and max duration", () => {
    expect(validateSlot(slot({ endsAt: t("09:03") }), []).map((i) => i.code)).toEqual(["too_short"]);
    expect(validateSlot(slot({ endsAt: t("14:00") }), [], { maxMinutes: 240 }).map((i) => i.code)).toEqual(["too_long"]);
  });

  it("blocks doctor double-booking", () => {
    const other = slot({ id: "x", roomId: "room-2", patientId: "pt-2", startsAt: t("09:10"), endsAt: t("09:25") });
    const issues = validateSlot(slot(), [other]);
    expect(issues).toEqual([expect.objectContaining({ code: "doctor_conflict", severity: "blocking", conflictingId: "x" })]);
    expect(hasBlocking(issues)).toBe(true);
  });

  it("blocks room double-booking across doctors", () => {
    const other = slot({ id: "y", doctorId: "dr-b", patientId: "pt-2" });
    expect(validateSlot(slot(), [other]).map((i) => i.code)).toEqual(["room_conflict"]);
  });

  it("does not treat two room-less appointments as a room clash", () => {
    const other = slot({ id: "z", doctorId: "dr-b", patientId: "pt-2", roomId: null });
    expect(validateSlot(slot({ roomId: null }), [other])).toEqual([]);
  });

  it("only warns when the patient is double-booked", () => {
    const other = slot({ id: "p", doctorId: "dr-b", roomId: "room-9" });
    const issues = validateSlot(slot(), [other]);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([["patient_conflict", "warning"]]);
    expect(hasBlocking(issues)).toBe(false);
  });

  it("ignores cancelled and no-show appointments", () => {
    expect(validateSlot(slot(), [slot({ id: "c", status: "cancelled" }), slot({ id: "n", status: "no_show" })])).toEqual([]);
  });

  it("ignores the appointment being edited", () => {
    expect(validateSlot(slot({ id: "same" }), [slot({ id: "same" })])).toEqual([]);
  });

  it("a cancelled candidate never conflicts", () => {
    expect(validateSlot(slot({ status: "cancelled" }), [slot({ id: "o" })])).toEqual([]);
  });

  it("warns about past start times unless back-entry is allowed", () => {
    const now = t("10:00");
    expect(validateSlot(slot(), [], { now }).map((i) => i.code)).toEqual(["in_past"]);
    expect(validateSlot(slot(), [], { now, allowPast: true })).toEqual([]);
  });
});

describe("holdsSlot", () => {
  it("is false only for cancelled and no-show", () => {
    expect(holdsSlot("scheduled")).toBe(true);
    expect(holdsSlot("completed")).toBe(true);
    expect(holdsSlot("cancelled")).toBe(false);
    expect(holdsSlot("no_show")).toBe(false);
  });
});
