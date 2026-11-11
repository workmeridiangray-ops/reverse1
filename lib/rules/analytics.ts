/**
 * Clinic statistics that refuse to mislead. Pure.
 *
 *  1. MEDIAN and 90th PERCENTILE, never the mean. Waiting times are skewed:
 *     one patient who waited three hours drags an average up and tells a
 *     manager nothing about a typical morning.
 *  2. NO PERCENTAGE WITHOUT ITS DENOMINATOR: always "12 of 40 (30.0%)".
 *  3. UNDER 10 OBSERVATIONS the answer is "too few to judge", not a number a
 *     manager might act on. (The threshold is a default; it is a number to
 *     review, not a statistical law.)
 *  4. Rows that cannot be used (missing or impossible timestamps) are counted
 *     and shown, not silently dropped.
 *
 * PARITY: quantile() uses linear interpolation (Hyndman-Fan type 7), the same
 * definition as Postgres percentile_cont, proved in tests/db/analytics.test.ts.
 */

export const MIN_SAMPLE = 10;

/** Quantile of an ascending-sorted array, linear interpolation (type 7). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new Error("No values");
  if (!(q >= 0 && q <= 1)) throw new Error("q must be between 0 and 1");
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export type SampleStatus = "ok" | "too_few" | "none";

export interface DurationSummary {
  /** usable observations */
  n: number;
  /** rows dropped because the value was missing, not finite or negative */
  excluded: number;
  status: SampleStatus;
  median: number | null;
  p90: number | null;
  /** only when status is "ok" */
  fastest: number | null;
  slowest: number | null;
}

export function summarizeDurations(values: ReadonlyArray<number | null | undefined>, minN = MIN_SAMPLE): DurationSummary {
  const usable: number[] = [];
  let excluded = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) usable.push(v);
    else excluded++;
  }
  usable.sort((a, b) => a - b);
  const n = usable.length;
  if (n === 0) return { n, excluded, status: "none", median: null, p90: null, fastest: null, slowest: null };
  if (n < minN) return { n, excluded, status: "too_few", median: null, p90: null, fastest: null, slowest: null };
  return { n, excluded, status: "ok", median: quantile(usable, 0.5), p90: quantile(usable, 0.9), fastest: usable[0]!, slowest: usable[n - 1]! };
}

export interface Proportion {
  numerator: number;
  denominator: number;
  status: SampleStatus;
  /** percentage in tenths of a percent (305 = 30.5%), integer maths. Null unless status is "ok". */
  tenths: number | null;
}

/** numerator of denominator, in integer tenths of a percent, rounded half up. */
export function tenthsOfPercent(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0 || numerator > denominator) {
    throw new Error("Need whole numbers with 0 <= numerator <= denominator > 0");
  }
  // BigInt keeps numerator * 1000 exact even for large money totals in minor units.
  const n = BigInt(numerator) * 1000n;
  const d = BigInt(denominator);
  return Number((n + d / 2n) / d);
}

/**
 * `sampleSize` is how many observations stand behind the figures (patients,
 * invoices...). For money, numerator and denominator are minor units but the
 * sample is the number of invoices, so a handful of big invoices can't pass
 * for a trend.
 */
export function proportion(numerator: number, denominator: number, sampleSize: number = denominator, minN = MIN_SAMPLE): Proportion {
  if (denominator === 0) return { numerator, denominator, status: "none", tenths: null };
  if (sampleSize < minN) return { numerator, denominator, status: "too_few", tenths: null };
  return { numerator, denominator, status: "ok", tenths: tenthsOfPercent(numerator, denominator) };
}

export function formatPercent(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** Always names both numbers. `render` formats them (counts, money...). */
export function formatProportion(p: Proportion, render: (n: number) => string = String, sampleSize?: number): string {
  const base = `${render(p.numerator)} of ${render(p.denominator)}`;
  if (p.status === "none") return "No data in this period";
  if (p.status === "too_few") return `${base}: too few to judge${sampleSize !== undefined ? ` (${sampleSize}, need ${MIN_SAMPLE})` : ""}`;
  return `${base} (${formatPercent(p.tenths!)})`;
}

export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function describeSummary(s: DurationSummary, minN = MIN_SAMPLE): string {
  if (s.status === "none") return "No data in this period";
  if (s.status === "too_few") return `Too few to judge (${s.n} observations, need ${minN})`;
  return `Median ${formatMinutes(s.median!)}, 90% within ${formatMinutes(s.p90!)}`;
}
