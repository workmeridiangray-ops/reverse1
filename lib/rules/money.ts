/**
 * Money rules. Pure and dependency-free.
 *
 * All amounts are integer MINOR units (cents, pence, fils...) held in a
 * JavaScript `number`. Every operation asserts its inputs are safe integers,
 * so a float can never silently enter the arithmetic. Parsing goes from
 * strings, digit by digit, never through parseFloat.
 */

export type Minor = number;

export class MoneyError extends Error {
  override name = "MoneyError";
}

/** ISO-4217 exponent for the currencies we support. Default is 2. */
const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new MoneyError(`Invalid currency code: ${currency}`);
  return CURRENCY_EXPONENT[code] ?? 2;
}

export function assertMinor(value: unknown, label = "amount"): asserts value is Minor {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer in minor units, got ${String(value)}`);
  }
}

export function assertNonNegative(value: Minor, label = "amount"): void {
  assertMinor(value, label);
  if (value < 0) throw new MoneyError(`${label} must not be negative`);
}

function checked(result: number): Minor {
  if (!Number.isSafeInteger(result)) throw new MoneyError("Amount overflowed safe integer range");
  return result;
}

export function add(a: Minor, b: Minor): Minor {
  assertMinor(a, "a");
  assertMinor(b, "b");
  return checked(a + b);
}

export function subtract(a: Minor, b: Minor): Minor {
  assertMinor(a, "a");
  assertMinor(b, "b");
  return checked(a - b);
}

export function sum(values: readonly Minor[]): Minor {
  return values.reduce<Minor>((acc, v) => add(acc, v), 0);
}

/** Line total: quantity (positive integer) x unit price (minor units). */
export function lineTotal(quantity: number, unitPriceMinor: Minor): Minor {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new MoneyError("Quantity must be a positive whole number");
  }
  assertNonNegative(unitPriceMinor, "unit price");
  return checked(quantity * unitPriceMinor);
}

/**
 * Parse a user-typed major-unit string ("12.50", "1,250.5", "7") into minor
 * units for the given currency. Rejects more decimals than the currency has,
 * rather than rounding money the user did not type.
 */
export function parseMajor(input: string, currency: string): Minor {
  const exp = currencyExponent(currency);
  const cleaned = input.trim().replace(/[,\s_]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) throw new MoneyError(`"${input}" is not a valid amount`);
  const [, sign, whole = "0", frac = ""] = match;
  if (frac.length > exp) {
    throw new MoneyError(`${currency.toUpperCase()} allows at most ${exp} decimal place(s)`);
  }
  const digits = whole + frac.padEnd(exp, "0");
  const value = Number(digits.replace(/^0+(?=\d)/, ""));
  if (!Number.isSafeInteger(value)) throw new MoneyError("Amount is too large");
  return sign ? -value : value;
}

/** Render minor units as a plain decimal string without float math. */
export function toMajorString(amount: Minor, currency: string): string {
  assertMinor(amount);
  const exp = currencyExponent(currency);
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(exp + 1, "0");
  const whole = exp === 0 ? digits : digits.slice(0, -exp);
  const frac = exp === 0 ? "" : digits.slice(-exp);
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Locale-aware display. Formatting a decimal string avoids float rounding. */
export function formatMoney(amount: Minor, currency: string, locale = "en-US"): string {
  const exp = currencyExponent(currency);
  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
  // Intl accepts numeric strings (ES2023 Intl.NumberFormat v3) and keeps full precision.
  return fmt.format(toMajorString(amount, currency) as `${number}`);
}

/**
 * Split an amount into parts proportional to integer weights, distributing the
 * remainder one minor unit at a time (largest remainder first) so the parts
 * always add back up to the original amount exactly.
 */
export function allocate(amount: Minor, weights: readonly number[]): Minor[] {
  assertMinor(amount);
  if (weights.length === 0) throw new MoneyError("Need at least one weight");
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new MoneyError("Weights must be non-negative integers");
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) throw new MoneyError("Weights must not all be zero");

  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  // BigInt keeps abs * weight exact even for very large invoices.
  const shares = weights.map((w, i) => {
    const num = BigInt(abs) * BigInt(w);
    return { i, floor: Number(num / BigInt(total)), rem: num % BigInt(total) };
  });
  let leftover = abs - shares.reduce((a, s) => a + s.floor, 0);
  const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const result = shares.map((s) => s.floor);
  for (const s of order) {
    if (leftover === 0) break;
    result[s.i] = (result[s.i] ?? 0) + 1;
    leftover -= 1;
  }
  return result.map((v) => (v === 0 ? 0 : v * sign));
}
