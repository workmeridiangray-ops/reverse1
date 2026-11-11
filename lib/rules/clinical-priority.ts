/**
 * ============================================================================
 *  CLINICAL PLACEHOLDER - REQUIRES CLINICIAN REVIEW BEFORE PRODUCTION USE
 * ============================================================================
 * Ordering of the doctor's worklist decides what a clinician sees first. The
 * ordering below is an engineering default, not a clinically validated triage
 * rule. A clinician must review and sign off `PRIORITY_ORDER` and the
 * definition of "critical" before this is used with real patients.
 *
 * "Critical" is either a flag a clinician sets by hand on a consultation (with
 * a written reason) or a lab result flagged critical that its ordering doctor
 * has not yet acknowledged. What counts as critical numerically comes from the
 * laboratory's reference ranges, which are also placeholders until reviewed.
 * ============================================================================
 */
import type { AppointmentStatus } from "./scheduling";

export const CLINICAL_REVIEW_REQUIRED = true as const;

export interface WorklistItem {
  appointmentId: string | null;
  consultationId: string | null;
  patientName: string;
  startsAt: Date | null;
  appointmentStatus: AppointmentStatus | null;
  /** consultation exists and is not yet signed */
  unsignedNote: boolean;
  critical: boolean;
  criticalReason: string | null;
  /** note belongs to a previous day (carried over until signed) */
  carriedOver: boolean;
  /** set when the item is a critical lab result waiting for acknowledgement */
  labResultId?: string | null;
}

export type WorklistBucket = "critical" | "unsigned" | "today" | "done";

/** PLACEHOLDER ordering - see banner above. Lower comes first. */
export const PRIORITY_ORDER: Readonly<Record<WorklistBucket, number>> = {
  critical: 0,
  unsigned: 1,
  today: 2,
  done: 3,
};

export function bucketFor(item: WorklistItem): WorklistBucket {
  if (item.critical) return "critical";
  if (item.unsignedNote) return "unsigned";
  const s = item.appointmentStatus;
  if (s === "completed" || s === "cancelled" || s === "no_show") return "done";
  return "today";
}

const STATUS_WEIGHT: Partial<Record<AppointmentStatus, number>> = {
  in_room: 0,
  arrived: 1,
  scheduled: 2,
};

export function sortWorklist(items: readonly WorklistItem[]): Array<WorklistItem & { bucket: WorklistBucket }> {
  return items
    .map((item) => ({ ...item, bucket: bucketFor(item) }))
    .sort((a, b) => {
      const byBucket = PRIORITY_ORDER[a.bucket] - PRIORITY_ORDER[b.bucket];
      if (byBucket !== 0) return byBucket;
      if (a.bucket === "today") {
        const sw = (STATUS_WEIGHT[a.appointmentStatus ?? "scheduled"] ?? 3) - (STATUS_WEIGHT[b.appointmentStatus ?? "scheduled"] ?? 3);
        if (sw !== 0) return sw;
      }
      // Older carried-over notes first, then by time.
      if (a.carriedOver !== b.carriedOver) return a.carriedOver ? -1 : 1;
      return (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0);
    });
}

export function validateCriticalFlag(critical: boolean, reason: string | null | undefined): string[] {
  if (critical && !reason?.trim()) return ["Give a reason when marking a patient critical."];
  return [];
}
