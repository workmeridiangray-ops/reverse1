/**
 * Lab result flagging. Pure.
 *
 * ============================================================================
 *  CLINICAL PLACEHOLDER - REQUIRES CLINICIAN REVIEW
 * ============================================================================
 * The LOGIC here (pick the range by sex and age, then compare) is general.
 * The NUMBERS (reference ranges and critical limits) are data a clinician or
 * laboratory must supply and sign off. The seed data ships placeholder ranges
 * marked "not reviewed", and results flagged from an unreviewed range say so.
 * ============================================================================
 *
 * Rules
 *  1. The range is chosen by the patient's sex and age BEFORE comparing, so
 *     13 g/dL haemoglobin is normal for a woman and low for a man.
 *  2. A sex-specific range is used only when it matches the patient's sex at
 *     birth. For intersex / unknown, only "any sex" ranges apply. Never guess.
 *  3. No matching range (or more than one in the same tier) => "unflagged".
 *     Unflagged is not normal: it means "no verdict".
 *  4. Critical limits are strict: below critical_low or above critical_high.
 *
 * PARITY: mirrored by app.pick_reference_range / app.flag_value in the
 * database, which sets the stored flag. tests/db/lab-parity.test.ts proves
 * both agree.
 */

export const LAB_REVIEW_REQUIRED = true as const;

export type LabSex = "female" | "male" | "intersex" | "unknown";
export type RangeSex = "any" | "female" | "male";
export type ResultFlag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "unflagged";

export interface ReferenceRange {
  id: string;
  sex: RangeSex;
  /** inclusive */
  ageMinYears: number;
  /** exclusive */
  ageMaxYears: number;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  reviewed: boolean;
}

export function rangeApplies(range: ReferenceRange, ageYears: number): boolean {
  return ageYears >= range.ageMinYears && ageYears < range.ageMaxYears;
}

/** The single applicable range, or null when none (or ambiguity). */
export function pickRange(ranges: readonly ReferenceRange[], sex: LabSex, ageYears: number): ReferenceRange | null {
  if (!Number.isFinite(ageYears) || ageYears < 0) return null;
  const inAge = ranges.filter((r) => rangeApplies(r, ageYears));
  if (sex === "female" || sex === "male") {
    const specific = inAge.filter((r) => r.sex === sex);
    if (specific.length > 1) return null;
    if (specific.length === 1) return specific[0]!;
  }
  const any = inAge.filter((r) => r.sex === "any");
  return any.length === 1 ? any[0]! : null;
}

export function flagValue(
  value: number,
  range: Pick<ReferenceRange, "low" | "high" | "criticalLow" | "criticalHigh"> | null,
): ResultFlag {
  if (!range || !Number.isFinite(value)) return "unflagged";
  const { low, high, criticalLow, criticalHigh } = range;
  if (criticalLow !== null && value < criticalLow) return "critical_low";
  if (criticalHigh !== null && value > criticalHigh) return "critical_high";
  if (low === null && high === null) return "unflagged";
  if (low !== null && value < low) return "low";
  if (high !== null && value > high) return "high";
  return "normal";
}

export interface FlagOutcome {
  flag: ResultFlag;
  range: ReferenceRange | null;
}

export function flagResult(value: number, ranges: readonly ReferenceRange[], sex: LabSex, ageYears: number): FlagOutcome {
  const range = pickRange(ranges, sex, ageYears);
  return { flag: flagValue(value, range), range };
}

export const isCritical = (f: ResultFlag): boolean => f === "critical_low" || f === "critical_high";
export const isAbnormal = (f: ResultFlag): boolean => f !== "normal" && f !== "unflagged";

export const FLAG_LABEL: Readonly<Record<ResultFlag, string>> = {
  normal: "Normal",
  low: "Low",
  high: "High",
  critical_low: "Critical low",
  critical_high: "Critical high",
  unflagged: "No reference range",
};

/** Problems with a range definition, for the admin editor and the DB constraints. */
export function validateRange(r: Omit<ReferenceRange, "id" | "reviewed">): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(r.ageMinYears) || !Number.isInteger(r.ageMaxYears) || r.ageMinYears < 0 || r.ageMaxYears <= r.ageMinYears) {
    issues.push("Age range must be whole years with the maximum above the minimum.");
  }
  const { low, high, criticalLow, criticalHigh } = r;
  if (low !== null && high !== null && !(low < high)) issues.push("Low must be below high.");
  if (criticalLow !== null && low !== null && !(criticalLow <= low)) issues.push("Critical low must not be above low.");
  if (criticalHigh !== null && high !== null && !(criticalHigh >= high)) issues.push("Critical high must not be below high.");
  if (criticalLow !== null && criticalHigh !== null && !(criticalLow < criticalHigh)) issues.push("Critical low must be below critical high.");
  if (low === null && high === null && criticalLow === null && criticalHigh === null) issues.push("Give at least one limit.");
  return issues;
}

/** Ranges for the same test and sex must not overlap in age (the DB enforces this too). */
export function rangesOverlap(a: Pick<ReferenceRange, "sex" | "ageMinYears" | "ageMaxYears">, b: Pick<ReferenceRange, "sex" | "ageMinYears" | "ageMaxYears">): boolean {
  return a.sex === b.sex && a.ageMinYears < b.ageMaxYears && b.ageMinYears < a.ageMaxYears;
}

export type ParsedValue = { ok: true; value: number } | { ok: false; error: string };

/** Lab values are typed as plain decimals. Qualifiers such as "<0.5" are not supported yet. */
export function parseResultValue(input: string | null | undefined): ParsedValue {
  const t = (input ?? "").trim().replace(",", ".");
  if (t === "") return { ok: false, error: "Enter a value." };
  if (!/^\d{1,7}(\.\d{1,4})?$/.test(t)) {
    return { ok: false, error: "Enter a number such as 6.8 (qualifiers like < or > aren't supported yet)." };
  }
  return { ok: true, value: Number(t) };
}

export function describeResult(testName: string, value: number, unit: string, flag: ResultFlag): string {
  return `${testName} ${value} ${unit} (${FLAG_LABEL[flag].toLowerCase()})`;
}
