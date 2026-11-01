/**
 * Appointment status machine. Pure.
 *
 * PARITY: mirrored by the trigger function `app.enforce_appointment_transition`
 * in supabase/migrations. tests/db/status-parity.test.ts checks every pair.
 */
import type { AppointmentStatus } from "./scheduling";

export const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "scheduled",
  "arrived",
  "in_room",
  "completed",
  "cancelled",
  "no_show",
];

export const TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  scheduled: ["arrived", "cancelled", "no_show"],
  // "arrived" -> "scheduled" undoes an accidental check-in.
  arrived: ["in_room", "scheduled", "cancelled"],
  in_room: ["completed", "arrived"],
  completed: [],
  cancelled: [],
  no_show: ["scheduled"],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isTerminal(status: AppointmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export const STATUS_LABEL: Readonly<Record<AppointmentStatus, string>> = {
  scheduled: "Expected",
  arrived: "Checked in",
  in_room: "With doctor",
  completed: "Done",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** Verb shown on the button that moves an appointment into `to`. */
export const TRANSITION_ACTION: Readonly<Record<AppointmentStatus, string>> = {
  scheduled: "Undo check-in",
  arrived: "Check in",
  in_room: "Send to room",
  completed: "Mark done",
  cancelled: "Cancel",
  no_show: "Mark no-show",
};
