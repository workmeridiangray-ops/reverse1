/**
 * Allergy checking for prescribing. Pure.
 *
 * Principles
 *  - Match by drug CLASS, not by name.
 *  - WARN and require a written reason; never block. Software that refuses
 *    gets worked around. The reason is stored on the prescription and shown
 *    to the pharmacist.
 *  - Never report "safe" when the check could not run: unknown drugs and
 *    patients with no allergy record say so.
 *
 * PARITY: the direct-match rule and the override-reason requirement are also
 * enforced by app.prescription_allergy_rules() in the database, so the rule
 * holds even if a client skips this module. Cross-reactivity is advisory and
 * lives only here. tests/db/allergy-parity.test.ts proves they agree.
 *
 * Drug classes and cross-reactions come from drug-catalog.ts and are
 * CLINICAL PLACEHOLDERS awaiting clinician review.
 */
import { classesForDrug, CROSS_REACTIVE, type DrugClass, isDrugClass } from "./drug-catalog";

export const MIN_OVERRIDE_REASON_LENGTH = 10;

export type AllergySeverity = "mild" | "moderate" | "severe";

export interface AllergyRecord {
  id: string;
  kind: "allergy" | "nkda";
  allergen: string | null;
  allergenClass: string | null;
  severity: AllergySeverity | null;
  reaction: string | null;
  /** soft-removed entries are ignored */
  removed: boolean;
}

/** What we know about the patient's allergies at all. */
export type AllergyRecordState = "has_allergies" | "no_known_allergies" | "not_recorded";

export type AllergyCheckStatus = "conflict" | "cross_reactive" | "unchecked" | "no_allergy_record" | "clear";

export interface AllergyFinding {
  allergyId: string;
  allergen: string;
  severity: AllergySeverity | null;
  reaction: string | null;
  match: "direct" | "cross";
  message: string;
}

export interface AllergyCheck {
  status: AllergyCheckStatus;
  drugClasses: DrugClass[];
  findings: AllergyFinding[];
  /** recorded allergies that cannot be matched automatically (e.g. "peanuts") */
  unmatchable: string[];
  /** a written reason is required before this can be prescribed */
  requiresReason: boolean;
  /** true only for direct class matches: what the database enforces */
  hasDirectConflict: boolean;
  recordState: AllergyRecordState;
}

export function allergyRecordState(records: readonly AllergyRecord[]): AllergyRecordState {
  const live = records.filter((r) => !r.removed);
  if (live.some((r) => r.kind === "allergy")) return "has_allergies";
  if (live.some((r) => r.kind === "nkda")) return "no_known_allergies";
  return "not_recorded";
}

/**
 * Check one medicine against a patient's allergy records.
 * `manualClasses` lets a prescriber classify a drug the catalog does not know.
 */
export function checkAllergies(
  drugName: string,
  records: readonly AllergyRecord[],
  manualClasses: readonly string[] = [],
): AllergyCheck {
  const classes = new Set<DrugClass>(classesForDrug(drugName));
  for (const c of manualClasses) if (isDrugClass(c)) classes.add(c);
  const drugClasses = [...classes];
  const recordState = allergyRecordState(records);
  const live = records.filter((r) => !r.removed && r.kind === "allergy");

  const findings: AllergyFinding[] = [];
  for (const a of live) {
    const cls = a.allergenClass;
    if (!cls || !isDrugClass(cls)) continue;
    const allergen = a.allergen ?? cls;
    if (classes.has(cls)) {
      findings.push({
        allergyId: a.id,
        allergen,
        severity: a.severity,
        reaction: a.reaction,
        match: "direct",
        message: `${capitalize(drugName.trim() || "This medicine")} is in the same class as ${allergen} (recorded allergy${a.severity ? `, ${a.severity}` : ""}${a.reaction ? `: ${a.reaction}` : ""}).`,
      });
      continue;
    }
    const crossWith = CROSS_REACTIVE[cls] ?? [];
    if (drugClasses.some((dc) => crossWith.includes(dc))) {
      findings.push({
        allergyId: a.id,
        allergen,
        severity: a.severity,
        reaction: a.reaction,
        match: "cross",
        message: `Possible cross-reaction: ${allergen} is recorded, and this medicine is in a related class.`,
      });
    }
  }

  const unmatchable = live.filter((a) => !a.allergenClass || !isDrugClass(a.allergenClass)).map((a) => a.allergen ?? "Unnamed");
  const hasDirectConflict = findings.some((f) => f.match === "direct");
  let status: AllergyCheckStatus;
  if (hasDirectConflict) status = "conflict";
  else if (findings.length > 0) status = "cross_reactive";
  else if (drugClasses.length === 0) status = "unchecked";
  else if (recordState === "not_recorded") status = "no_allergy_record";
  else status = "clear";

  return {
    status,
    drugClasses,
    findings,
    unmatchable,
    requiresReason: findings.length > 0,
    hasDirectConflict,
    recordState,
  };
}

/** Why an override reason is not acceptable, or null if it is. */
export function validateOverrideReason(check: Pick<AllergyCheck, "requiresReason">, reason: string | null | undefined): string | null {
  if (!check.requiresReason) return null;
  const r = reason?.trim() ?? "";
  if (r.length < MIN_OVERRIDE_REASON_LENGTH) {
    return `Write why this is still appropriate (at least ${MIN_OVERRIDE_REASON_LENGTH} characters). The pharmacist will see it.`;
  }
  return null;
}

/** The allergy_check_status the database stores. Mirrors app.prescription_allergy_rules(). */
export type StoredAllergyStatus = "clear" | "overridden" | "unchecked" | "no_allergy_record";

export function storedAllergyStatus(check: AllergyCheck, reason: string | null | undefined): StoredAllergyStatus {
  const hasReason = (reason?.trim().length ?? 0) > 0;
  if (check.hasDirectConflict || hasReason) return "overridden";
  if (check.drugClasses.length === 0) return "unchecked";
  if (check.recordState === "not_recorded") return "no_allergy_record";
  return "clear";
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
