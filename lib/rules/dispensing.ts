/**
 * Batch dispensing rules. Pure. Dates are clinic-local ISO strings (YYYY-MM-DD)
 * so no time-zone arithmetic is needed here; the caller passes "today".
 *
 * Stock goes out FIRST-EXPIRY-FIRST-OUT (FEFO). A batch that is in date today
 * can still run out PARTWAY THROUGH a course: a batch expiring in 20 days
 * dispensed for a 30-day course would leave the patient taking expired
 * medicine. No other part of a clinic system knows both facts at once
 * (expiry on the shelf, length of the course), so this is where they meet.
 *
 * PARITY: app.expires_mid_course() and public.dispense_prescription() in the
 * database apply the same definitions and refuse unsafe dispensing even if a
 * client skips this module. tests/db/dispensing-parity.test.ts proves they
 * agree. Pack-size, controlled-drug and cold-chain rules are NOT modelled:
 * they need a pharmacist's review. CLINICAL PLACEHOLDER.
 */

export const DISPENSING_REVIEW_REQUIRED = true as const;

export type BatchStatus = "available" | "quarantined" | "recalled";

export interface StockBatch {
  id: string;
  batchNumber: string;
  /** last day the batch may be used, inclusive */
  expiryDate: string;
  onHand: number;
  status: BatchStatus;
}

export type BatchState = "usable" | "expired" | "quarantined" | "recalled" | "empty";

export const MIN_NOTE_LENGTH = 10;
export const EXPIRING_SOON_DAYS = 30;

export function addDays(dateKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) throw new Error(`Invalid date: ${dateKey}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(fromKey: string, toKey: string): number {
  const parse = (k: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    if (!m) throw new Error(`Invalid date: ${k}`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((parse(toKey) - parse(fromKey)) / 86_400_000);
}

/** Last day the patient takes the medicine, counting the dispensing day as day 1. */
export function courseLastDay(start: string, coverDays: number): string {
  return addDays(start, coverDays - 1);
}

/**
 * True when the batch is in date on `start` but expires BEFORE the last day of
 * the course. (Expiring on the last day itself is fine: expiry is inclusive.)
 * No cover length means the course length is unknown, so no verdict.
 */
export function expiresMidCourse(expiryDate: string, start: string, coverDays: number | null): boolean {
  if (coverDays === null || !Number.isInteger(coverDays) || coverDays < 1) return false;
  return expiryDate >= start && expiryDate < courseLastDay(start, coverDays);
}

export function batchState(b: StockBatch, today: string): BatchState {
  if (b.status === "recalled") return "recalled";
  if (b.status === "quarantined") return "quarantined";
  if (b.expiryDate < today) return "expired";
  if (b.onHand <= 0) return "empty";
  return "usable";
}

export const isEligible = (b: StockBatch, today: string): boolean => batchState(b, today) === "usable";

export type ExpiryBand = "expired" | "soon" | "ok";
export function expiryBand(expiryDate: string, today: string, soonDays = EXPIRING_SOON_DAYS): ExpiryBand {
  if (expiryDate < today) return "expired";
  return daysBetween(today, expiryDate) <= soonDays ? "soon" : "ok";
}

export interface Allocation {
  batchId: string;
  quantity: number;
}

export interface PlannedAllocation extends Allocation {
  batchNumber: string;
  expiryDate: string;
  midCourse: boolean;
}

export interface DispenseFlags {
  /** a batch used expires before the course ends */
  midCourse: boolean;
  /** a later-expiry batch was used while an earlier-expiry batch still had stock */
  fefoSkipped: boolean;
}

export interface DispensePlan {
  allocations: PlannedAllocation[];
  /** units that could not be found in usable stock */
  shortfall: number;
  flags: DispenseFlags;
}

function byExpiry(a: StockBatch, b: StockBatch): number {
  return a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pick stock first-expiry-first-out. With `avoidMidCourse`, batches that would
 * run out mid-course are used last (only if the longer-dated stock isn't enough).
 */
export function planDispense(args: {
  batches: readonly StockBatch[];
  quantity: number;
  today: string;
  coverDays: number | null;
  avoidMidCourse?: boolean;
}): DispensePlan {
  const { batches, quantity, today, coverDays, avoidMidCourse = false } = args;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a positive whole number");
  const pool = batches.filter((b) => isEligible(b, today));
  const mid = (b: StockBatch) => expiresMidCourse(b.expiryDate, today, coverDays);
  const ordered = avoidMidCourse
    ? [...pool.filter((b) => !mid(b)).sort(byExpiry), ...pool.filter(mid).sort(byExpiry)]
    : [...pool].sort(byExpiry);

  let left = quantity;
  const allocations: PlannedAllocation[] = [];
  for (const b of ordered) {
    if (left === 0) break;
    const take = Math.min(left, b.onHand);
    allocations.push({ batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: take, midCourse: mid(b) });
    left -= take;
  }
  return { allocations, shortfall: left, flags: flagsFor(allocations, batches, today, coverDays) };
}

/** Flags for ANY allocation (suggested or hand-picked). Mirrors public.dispense_prescription(). */
export function flagsFor(allocations: readonly Allocation[], batches: readonly StockBatch[], today: string, coverDays: number | null): DispenseFlags {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const used = allocations.filter((a) => a.quantity > 0).map((a) => ({ a, b: byId.get(a.batchId) })).filter((x): x is { a: Allocation; b: StockBatch } => !!x.b);
  const midCourse = used.some(({ b }) => expiresMidCourse(b.expiryDate, today, coverDays));
  if (used.length === 0) return { midCourse: false, fefoSkipped: false };
  const latest = used.reduce((m, { b }) => (b.expiryDate > m ? b.expiryDate : m), used[0]!.b.expiryDate);
  const takenFrom = new Map<string, number>();
  for (const { a } of used) takenFrom.set(a.batchId, (takenFrom.get(a.batchId) ?? 0) + a.quantity);
  const fefoSkipped = batches.some((b) => isEligible(b, today) && b.expiryDate < latest && b.onHand - (takenFrom.get(b.id) ?? 0) > 0);
  return { midCourse, fefoSkipped };
}

/** Problems that make an allocation impossible or unsafe (the database refuses these too). */
export function validateAllocations(allocations: readonly Allocation[], batches: readonly StockBatch[], today: string): string[] {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const issues: string[] = [];
  const seen = new Set<string>();
  if (allocations.length === 0) issues.push("Choose at least one batch.");
  for (const a of allocations) {
    const b = byId.get(a.batchId);
    if (!b) { issues.push("A chosen batch isn't in stock for this medicine."); continue; }
    if (seen.has(a.batchId)) issues.push(`Batch ${b.batchNumber} is listed twice.`);
    seen.add(a.batchId);
    if (!Number.isInteger(a.quantity) || a.quantity <= 0) { issues.push(`Quantity from batch ${b.batchNumber} must be a positive whole number.`); continue; }
    const s = batchState(b, today);
    if (s === "expired") issues.push(`Batch ${b.batchNumber} has expired.`);
    else if (s === "quarantined") issues.push(`Batch ${b.batchNumber} is quarantined.`);
    else if (s === "recalled") issues.push(`Batch ${b.batchNumber} has been recalled.`);
    else if (a.quantity > b.onHand) issues.push(`Only ${b.onHand} left in batch ${b.batchNumber}.`);
  }
  return issues;
}

/** Why a written note is needed before dispensing (empty = none). */
export function noteReasons(flags: DispenseFlags, allergyFlagged: boolean): string[] {
  const r: string[] = [];
  if (flags.midCourse) r.push("a batch expires before the course ends");
  if (flags.fefoSkipped) r.push("an earlier-expiry batch was skipped");
  if (allergyFlagged) r.push("the patient has a recorded allergy to this medicine's class");
  return r;
}

export function validateNote(reasons: readonly string[], note: string | null | undefined): string | null {
  if (reasons.length === 0) return null;
  if ((note?.trim().length ?? 0) < MIN_NOTE_LENGTH) {
    return `Write a note (at least ${MIN_NOTE_LENGTH} characters) because ${reasons.join(" and ")}.`;
  }
  return null;
}

/* ------------------------- suggested quantity ------------------------- */

const PER_DAY: Readonly<Record<string, number>> = {
  "once daily": 1, "twice daily": 2, "three times daily": 3, "four times daily": 4, "every 8 hours": 3, "every 12 hours": 2,
};
const COUNTABLE = /^\s*(\d+(?:\.\d+)?)\s*(?:x\s*)?(tablet|tab|capsule|cap|puff|sachet|patch|drop|ml)s?\b/i;

export function unitsPerDose(dose: string): number | null {
  const m = COUNTABLE.exec(dose);
  if (!m) return null; // "500 mg" is a strength, not a count: don't guess
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A suggested supply, or null when it can't be worked out safely (the pharmacist enters it). */
export function suggestSupply(dose: string, frequency: string, durationDays: number | null): { quantity: number; coverDays: number } | null {
  const per = unitsPerDose(dose);
  if (per === null) return null;
  const f = frequency.trim().toLowerCase();
  if (f === "once only") return { quantity: Math.ceil(per), coverDays: 1 };
  if (durationDays === null || !Number.isInteger(durationDays) || durationDays < 1) return null;
  if (f === "weekly") return { quantity: Math.ceil(per * Math.ceil(durationDays / 7)), coverDays: durationDays };
  const perDay = PER_DAY[f];
  if (perDay === undefined) return null; // "as needed"
  return { quantity: Math.ceil(per * perDay * durationDays), coverDays: durationDays };
}

/** How many days a typed quantity lasts, if the prescription is specific enough to say. */
export function coverDaysFor(quantity: number, dose: string, frequency: string, durationDays: number | null): number | null {
  if (durationDays !== null) return durationDays;
  const per = unitsPerDose(dose);
  const perDay = PER_DAY[frequency.trim().toLowerCase()];
  if (per === null || perDay === undefined) return null;
  return Math.max(1, Math.floor(quantity / (per * perDay)));
}

/**
 * Guard against picking the wrong product off the shelf. If both the
 * prescription and the product carry drug classes, they must overlap; if
 * either is unclassified there is nothing to compare and the pharmacist's
 * eyes are the check. Mirrors public.dispense_prescription().
 */
export function productMatchesPrescription(prescribedClasses: readonly string[], productClasses: readonly string[]): boolean {
  if (prescribedClasses.length === 0 || productClasses.length === 0) return true;
  return prescribedClasses.some((c) => productClasses.includes(c));
}
