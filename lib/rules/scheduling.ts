/**
 * Scheduling rules: conflicts and appointment validity. Pure.
 *
 * Intervals are half-open [start, end): a 09:00-09:15 slot does not clash with
 * a 09:15-09:30 slot. The database enforces the same rule for doctors and rooms
 * with exclusion constraints on tstzrange(starts_at, ends_at, '[)'); this module
 * lets the UI explain a clash before the insert fails, and also checks the
 * patient (who the database does not block, because double-booking a patient
 * across two services is sometimes intended; we warn instead).
 */

export type AppointmentStatus = "scheduled" | "arrived" | "in_room" | "completed" | "cancelled" | "no_show";

/** Appointments in these states no longer hold their slot. */
export const SLOT_RELEASING_STATUSES: readonly AppointmentStatus[] = ["cancelled", "no_show"];

export interface Slot {
  id?: string;
  startsAt: Date;
  endsAt: Date;
  doctorId: string;
  roomId: string | null;
  patientId: string;
  status: AppointmentStatus;
}

export type ScheduleIssueCode =
  | "invalid_range"
  | "too_short"
  | "too_long"
  | "in_past"
  | "doctor_conflict"
  | "room_conflict"
  | "patient_conflict";

export interface ScheduleIssue {
  code: ScheduleIssueCode;
  /** blocking issues stop the save; warnings ask the user to confirm */
  severity: "blocking" | "warning";
  message: string;
  conflictingId?: string;
}

export interface ScheduleOptions {
  minMinutes?: number;
  maxMinutes?: number;
  now?: Date;
  /** allow creating appointments that start in the past (back-entry) */
  allowPast?: boolean;
}

export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function holdsSlot(status: AppointmentStatus): boolean {
  return !SLOT_RELEASING_STATUSES.includes(status);
}

export function validateSlot(
  candidate: Slot,
  existing: readonly Slot[],
  options: ScheduleOptions = {},
): ScheduleIssue[] {
  const { minMinutes = 5, maxMinutes = 240, now, allowPast = false } = options;
  const issues: ScheduleIssue[] = [];
  const duration = (candidate.endsAt.getTime() - candidate.startsAt.getTime()) / 60000;

  if (!(duration > 0)) {
    issues.push({ code: "invalid_range", severity: "blocking", message: "End time must be after start time." });
    return issues;
  }
  if (duration < minMinutes) {
    issues.push({
      code: "too_short",
      severity: "blocking",
      message: `Appointments must be at least ${minMinutes} minutes.`,
    });
  }
  if (duration > maxMinutes) {
    issues.push({
      code: "too_long",
      severity: "blocking",
      message: `Appointments cannot be longer than ${maxMinutes} minutes.`,
    });
  }
  if (now && !allowPast && candidate.startsAt.getTime() < now.getTime() && candidate.status === "scheduled") {
    issues.push({ code: "in_past", severity: "warning", message: "This appointment starts in the past." });
  }
  if (!holdsSlot(candidate.status)) return issues;

  for (const other of existing) {
    if (candidate.id && other.id === candidate.id) continue;
    if (!holdsSlot(other.status) || !overlaps(candidate, other)) continue;
    if (other.doctorId === candidate.doctorId) {
      issues.push({
        code: "doctor_conflict",
        severity: "blocking",
        message: "The doctor already has an appointment at this time.",
        conflictingId: other.id,
      });
    }
    if (candidate.roomId && other.roomId === candidate.roomId) {
      issues.push({
        code: "room_conflict",
        severity: "blocking",
        message: "The room is already booked at this time.",
        conflictingId: other.id,
      });
    }
    if (other.patientId === candidate.patientId) {
      issues.push({
        code: "patient_conflict",
        severity: "warning",
        message: "The patient already has another appointment at this time.",
        conflictingId: other.id,
      });
    }
  }
  return issues;
}

export function hasBlocking(issues: readonly ScheduleIssue[]): boolean {
  return issues.some((i) => i.severity === "blocking");
}
