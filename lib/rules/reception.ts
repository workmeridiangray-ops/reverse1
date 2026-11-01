/**
 * Reception board: "who is here, and who is next". Pure.
 *
 * Ordering:
 *   1. Here and waiting  (arrived)           - longest wait first
 *   2. With a doctor     (in_room)           - by time sent in
 *   3. Expected          (scheduled)         - by start time; late ones flagged
 *   4. Finished          (completed)         - those who still owe money first
 *   5. Not coming        (cancelled/no_show) - by start time
 */
import { patientOwesNow, type PaymentStatus } from "./invoice";
import type { AppointmentStatus } from "./scheduling";

export interface BoardAppointment {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  checkedInAt: Date | null;
  roomedAt: Date | null;
  patientName: string;
  doctorName: string;
  roomId: string | null;
  roomName: string | null;
  /** null when no invoice exists for this visit yet */
  paymentStatus: PaymentStatus | null;
  consentMissing: boolean;
}

export type BoardGroup = "waiting" | "with_doctor" | "expected" | "finished" | "not_coming";

export interface BoardRow extends BoardAppointment {
  group: BoardGroup;
  /** minutes since check-in for waiting patients; null otherwise */
  waitingMinutes: number | null;
  /** minutes past start time for expected patients who have not arrived */
  lateMinutes: number | null;
  isNext: boolean;
  /** visit is done but money is still owed: stop them at the desk */
  owesAtCheckout: boolean;
}

export interface BoardSummary {
  here: number;
  waiting: number;
  withDoctor: number;
  expectedRemaining: number;
  late: number;
  owesAtCheckout: number;
  next: BoardRow | null;
}

const GROUP_ORDER: Record<BoardGroup, number> = {
  waiting: 0,
  with_doctor: 1,
  expected: 2,
  finished: 3,
  not_coming: 4,
};

/** Minutes after start time before an expected patient counts as late. */
export const LATE_GRACE_MINUTES = 10;

export function groupFor(status: AppointmentStatus): BoardGroup {
  switch (status) {
    case "arrived":
      return "waiting";
    case "in_room":
      return "with_doctor";
    case "scheduled":
      return "expected";
    case "completed":
      return "finished";
    case "cancelled":
    case "no_show":
      return "not_coming";
  }
}

function minutes(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60000);
}

export function buildBoard(
  appointments: readonly BoardAppointment[],
  now: Date,
): { rows: BoardRow[]; summary: BoardSummary } {
  const rows: BoardRow[] = appointments.map((a) => {
    const group = groupFor(a.status);
    const late = group === "expected" ? minutes(a.startsAt, now) : null;
    return {
      ...a,
      group,
      waitingMinutes: group === "waiting" && a.checkedInAt ? Math.max(0, minutes(a.checkedInAt, now)) : null,
      lateMinutes: late !== null && late > LATE_GRACE_MINUTES ? late : null,
      isNext: false,
      owesAtCheckout: group === "finished" && a.paymentStatus !== null && patientOwesNow(a.paymentStatus),
    };
  });

  const sortKey = (r: BoardRow): number => {
    switch (r.group) {
      case "waiting":
        return (r.checkedInAt ?? r.startsAt).getTime();
      case "with_doctor":
        return (r.roomedAt ?? r.startsAt).getTime();
      case "finished":
        return (r.owesAtCheckout ? 0 : 1e15) + r.startsAt.getTime();
      default:
        return r.startsAt.getTime();
    }
  };
  rows.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));

  // "Next" = whoever the desk should call next: longest-waiting checked-in
  // patient; if nobody is waiting, the next expected arrival.
  const next = rows.find((r) => r.group === "waiting") ?? rows.find((r) => r.group === "expected") ?? null;
  if (next) next.isNext = true;

  const count = (g: BoardGroup) => rows.filter((r) => r.group === g).length;
  return {
    rows,
    summary: {
      here: count("waiting") + count("with_doctor"),
      waiting: count("waiting"),
      withDoctor: count("with_doctor"),
      expectedRemaining: count("expected"),
      late: rows.filter((r) => r.lateMinutes !== null).length,
      owesAtCheckout: rows.filter((r) => r.owesAtCheckout).length,
      next,
    },
  };
}

/* ---------- Room availability ---------- */

export interface RoomInput {
  id: string;
  name: string;
  outOfService: boolean;
}

export type RoomState = "occupied" | "reserved_soon" | "free" | "out_of_service";

export interface RoomStatus {
  id: string;
  name: string;
  state: RoomState;
  /** patient currently in the room, if any */
  occupantName: string | null;
  /** when the room is next needed, if today */
  nextAt: Date | null;
  nextPatientName: string | null;
}

/** A room counts as "reserved soon" if a booking starts within this window. */
export const RESERVED_SOON_MINUTES = 15;

export function roomStatuses(
  rooms: readonly RoomInput[],
  appointments: readonly BoardAppointment[],
  now: Date,
): RoomStatus[] {
  return rooms
    .map((room) => {
      const forRoom = appointments.filter((a) => a.roomId === room.id);
      const occupant = forRoom.find((a) => a.status === "in_room") ?? null;
      const upcoming = forRoom
        .filter((a) => (a.status === "scheduled" || a.status === "arrived") && a.endsAt.getTime() > now.getTime())
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      let state: RoomState;
      if (room.outOfService) state = "out_of_service";
      else if (occupant) state = "occupied";
      else if (upcoming && minutes(now, upcoming.startsAt) <= RESERVED_SOON_MINUTES) state = "reserved_soon";
      else state = "free";
      return {
        id: room.id,
        name: room.name,
        state,
        occupantName: occupant?.patientName ?? null,
        nextAt: upcoming?.startsAt ?? null,
        nextPatientName: upcoming?.patientName ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
