/**
 * Quantities are integer milli-units (1.250 m³ = 1250); percentages are basis points (5.00% = 500).
 * Parsing is digit-by-digit: too many decimals is an error, never silently rounded.
 */
export class QtyError extends Error {
  override name = "QtyError";
}

function parseScaled(input: string, decimals: number, label: string): number {
  const cleaned = input.trim().replace(/[,\s_]/g, "");
  const m = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) throw new QtyError(`${label} "${input}" is not a valid non-negative number`);
  const [, whole = "0", frac = ""] = m;
  if (frac.length > decimals) throw new QtyError(`${label} allows at most ${decimals} decimal place(s)`);
  const v = Number(whole + frac.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(v)) throw new QtyError(`${label} is too large`);
  return v;
}

export const parseQty = (s: string, label = "Quantity") => parseScaled(s, 3, label);
export const parsePercentBp = (s: string, label = "Percentage") => parseScaled(s, 2, label);

function fmtScaled(v: number, decimals: number): string {
  const neg = v < 0;
  const d = String(Math.abs(v)).padStart(decimals + 1, "0");
  const whole = d.slice(0, -decimals);
  const frac = d.slice(-decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
export const formatQty = (milli: number) => fmtScaled(milli, 3);
export const formatPercent = (bp: number) => fmtScaled(bp, 2) + "%";

/** qty (milli) × rate (minor per unit) → minor units, half-up, exact via BigInt. */
export function amountFor(qtyMilli: number, rateMinor: number): number {
  const p = BigInt(qtyMilli) * BigInt(rateMinor);
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const r = (abs + 500n) / 1000n;
  const v = Number(neg ? -r : r);
  if (!Number.isSafeInteger(v)) throw new QtyError("Amount overflow");
  return v;
}

/** Percentage of an amount (bp), half-up, exact. */
export function percentOf(amountMinor: number, bp: number): number {
  const p = BigInt(amountMinor) * BigInt(bp);
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const r = (abs + 5000n) / 10000n;
  return Number(neg ? -r : r);
}

/** Signed quantity for variations (omissions are negative). */
export function parseSignedQty(s: string, label = "Quantity"): number {
  const t = s.trim();
  if (t.startsWith("-")) return -parseQty(t.slice(1), label);
  return parseQty(t.startsWith("+") ? t.slice(1) : t, label);
}
