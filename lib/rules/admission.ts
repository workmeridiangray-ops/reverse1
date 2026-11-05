/**
 * Admission and discharge rules. Pure.
 *
 * PARITY: mirrors app.required_clearances() and app.discharge_blockers() in
 * supabase/migrations/20261102000200_inpatient.sql. tests/db/inpatient-parity
 * proves both agree for every combination. The database enforces; this module
 * lets screens explain what is still outstanding before anyone clicks.
 */

export const CLEARANCE_DEPARTMENTS = ["finance", "pharmacy", "nursing"] as const;
export type ClearanceDepartment = (typeof CLEARANCE_DEPARTMENTS)[number];
export type AdmissionType = "elective" | "emergency";
export type AdmissionStatus = "requested" | "admitted" | "discharged" | "cancelled";
export type ClearanceStatus = "cleared" | "exception";

/** Hospital-defined: emergency admissions skip finance clearance unless the hospital says otherwise. */
export function requiredClearances(type: AdmissionType, emergencyNeedsFinance: boolean): ClearanceDepartment[] {
  return type === "emergency" && !emergencyNeedsFinance ? ["pharmacy", "nursing"] : ["finance", "pharmacy", "nursing"];
}

export interface DischargeFacts {
  status: AdmissionStatus;
  type: AdmissionType;
  emergencyNeedsFinance: boolean;
  authorised: boolean;
  hasSummary: boolean;
  clearances: ClearanceDepartment[];
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function dischargeBlockers(f: DischargeFacts): string[] {
  const out: string[] = [];
  if (f.status !== "admitted") out.push("Patient is not currently admitted");
  if (!f.authorised) out.push("Discharge has not been authorised by a doctor");
  if (!f.hasSummary) out.push("Discharge summary has not been written");
  for (const d of requiredClearances(f.type, f.emergencyNeedsFinance)) {
    if (!f.clearances.includes(d)) out.push(`${title(d)} clearance is outstanding`);
  }
  return out;
}

/** Elective admissions need a deposit reference when hospital policy says so. */
export function depositProblem(type: AdmissionType, requireDeposit: boolean, reference: string): string | null {
  if (type === "elective" && requireDeposit && reference.trim().length === 0) {
    return "Elective admissions need a deposit reference (hospital policy). Emergency admissions do not.";
  }
  return null;
}

export type BedState = "available" | "occupied" | "needs_cleaning" | "being_cleaned" | "out_of_service";

/** What a bed card should say. Occupancy is physical; cleaning is housekeeping. */
export function bedState(b: { outOfService: boolean; housekeeping: "clean" | "dirty" | "cleaning"; occupied: boolean }): BedState {
  if (b.outOfService) return "out_of_service";
  if (b.occupied) return "occupied";
  if (b.housekeeping === "dirty") return "needs_cleaning";
  if (b.housekeeping === "cleaning") return "being_cleaned";
  return "available";
}

export function canAllocate(state: BedState): boolean {
  return state === "available";
}

export const BED_STATE_LABEL: Record<BedState, string> = {
  available: "Available",
  occupied: "Occupied",
  needs_cleaning: "Needs cleaning",
  being_cleaned: "Being cleaned",
  out_of_service: "Out of service",
};
