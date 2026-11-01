import { describe, expect, it } from "vitest";
import { type BoardAppointment, buildBoard, roomStatuses } from "./reception";

const t = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
let n = 0;
const appt = (over: Partial<BoardAppointment>): BoardAppointment => ({
  id: `a${++n}`,
  startsAt: t("09:00"),
  endsAt: t("09:15"),
  status: "scheduled",
  checkedInAt: null,
  roomedAt: null,
  patientName: "Pat",
  doctorName: "Dr",
  roomId: null,
  roomName: null,
  paymentStatus: null,
  consentMissing: false,
  ...over,
});

describe("buildBoard", () => {
  const now = t("09:30");
  const rows = [
    appt({ id: "expected-late", patientName: "Late Lee", startsAt: t("09:00") }),
    appt({ id: "expected-later", patientName: "Later Lu", startsAt: t("10:00"), endsAt: t("10:15") }),
    appt({ id: "waiting-2", patientName: "Second", status: "arrived", startsAt: t("09:15"), checkedInAt: t("09:20") }),
    appt({ id: "waiting-1", patientName: "First", status: "arrived", startsAt: t("09:30"), checkedInAt: t("09:05") }),
    appt({ id: "in-room", status: "in_room", roomedAt: t("09:25"), roomId: "r1" }),
    appt({ id: "done-paid", status: "completed", startsAt: t("08:00"), paymentStatus: "paid" }),
    appt({ id: "done-owes", status: "completed", startsAt: t("08:30"), paymentStatus: "partially_paid" }),
    appt({ id: "cancelled", status: "cancelled", startsAt: t("08:15") }),
  ];
  const { rows: board, summary } = buildBoard(rows, now);

  it("orders: waiting (longest first), with doctor, expected, finished (owing first), not coming", () => {
    expect(board.map((r) => r.id)).toEqual([
      "waiting-1",
      "waiting-2",
      "in-room",
      "expected-late",
      "expected-later",
      "done-owes",
      "done-paid",
      "cancelled",
    ]);
  });

  it("marks the longest-waiting patient as next", () => {
    expect(board.filter((r) => r.isNext).map((r) => r.id)).toEqual(["waiting-1"]);
    expect(summary.next?.id).toBe("waiting-1");
  });

  it("computes wait and lateness in minutes", () => {
    expect(board.find((r) => r.id === "waiting-1")?.waitingMinutes).toBe(25);
    expect(board.find((r) => r.id === "expected-late")?.lateMinutes).toBe(30);
    expect(board.find((r) => r.id === "expected-later")?.lateMinutes).toBeNull();
  });

  it("flags finished visits that still owe money", () => {
    expect(board.find((r) => r.id === "done-owes")?.owesAtCheckout).toBe(true);
    expect(board.find((r) => r.id === "done-paid")?.owesAtCheckout).toBe(false);
  });

  it("summarises who is here and who is next", () => {
    expect(summary).toMatchObject({ here: 3, waiting: 2, withDoctor: 1, expectedRemaining: 2, late: 1, owesAtCheckout: 1 });
  });

  it("falls back to next expected arrival when nobody is waiting", () => {
    const { summary: s } = buildBoard(
      [appt({ id: "b", startsAt: t("11:00") }), appt({ id: "a", startsAt: t("10:00") })],
      t("09:00"),
    );
    expect(s.next?.id).toBe("a");
  });

  it("is not late within the grace period", () => {
    const { rows: r } = buildBoard([appt({ startsAt: t("09:00") })], t("09:10"));
    expect(r[0]?.lateMinutes).toBeNull();
  });

  it("handles an empty day", () => {
    expect(buildBoard([], now).summary).toMatchObject({ here: 0, next: null });
  });
});

describe("roomStatuses", () => {
  const rooms = [
    { id: "r2", name: "Room 2", outOfService: false },
    { id: "r10", name: "Room 10", outOfService: false },
    { id: "r1", name: "Room 1", outOfService: false },
    { id: "r3", name: "Room 3", outOfService: true },
  ];
  const now = t("09:00");
  const statuses = roomStatuses(
    rooms,
    [
      appt({ roomId: "r1", status: "in_room", patientName: "In Room" }),
      appt({ roomId: "r2", startsAt: t("09:10"), endsAt: t("09:25"), patientName: "Soon" }),
      appt({ roomId: "r10", startsAt: t("11:00"), endsAt: t("11:15"), patientName: "Later" }),
      appt({ roomId: "r3", status: "in_room" }),
    ],
    now,
  );

  it("sorts rooms naturally", () => {
    expect(statuses.map((s) => s.name)).toEqual(["Room 1", "Room 2", "Room 3", "Room 10"]);
  });

  it("derives occupied / reserved soon / free / out of service", () => {
    const by = Object.fromEntries(statuses.map((s) => [s.id, s]));
    expect(by.r1).toMatchObject({ state: "occupied", occupantName: "In Room" });
    expect(by.r2).toMatchObject({ state: "reserved_soon", nextPatientName: "Soon" });
    expect(by.r10).toMatchObject({ state: "free", nextPatientName: "Later" });
    expect(by.r3?.state).toBe("out_of_service");
  });
});
