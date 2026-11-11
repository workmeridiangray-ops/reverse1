/**
 * Lab order status machine. Pure.
 * PARITY: mirrored by app.lab_order_transition_allowed(); tests/db/lab-parity.test.ts
 * checks every pair.
 */
export type LabOrderStatus = "ordered" | "collected" | "resulted" | "cancelled";
export const LAB_ORDER_STATUSES: readonly LabOrderStatus[] = ["ordered", "collected", "resulted", "cancelled"];

export const LAB_ORDER_TRANSITIONS: Readonly<Record<LabOrderStatus, readonly LabOrderStatus[]>> = {
  ordered: ["collected", "resulted", "cancelled"],
  collected: ["resulted", "cancelled"],
  resulted: [],
  cancelled: [],
};

export function canTransitionLabOrder(from: LabOrderStatus, to: LabOrderStatus): boolean {
  return from === to || LAB_ORDER_TRANSITIONS[from].includes(to);
}

export const LAB_ORDER_LABEL: Readonly<Record<LabOrderStatus, string>> = {
  ordered: "Waiting for sample",
  collected: "Sample collected",
  resulted: "Resulted",
  cancelled: "Cancelled",
};

/** A result the ordering doctor still has to look at. */
export function needsDoctorAttention(r: { flag: string | null; acknowledgedAt: string | Date | null }): boolean {
  return (r.flag === "critical_low" || r.flag === "critical_high") && !r.acknowledgedAt;
}

/** May this result be shown to the patient? Mirrors the RLS policy (released only). */
export function visibleToPatient(r: { releasedAt: string | Date | null; value: number | null }): boolean {
  return r.releasedAt !== null && r.value !== null;
}
