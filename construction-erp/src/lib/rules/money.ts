// Money is integer paise (bigint). Quantities are integer milli-units (bigint, 3 decimals).
// Nothing here uses floating point. Too many decimals is an error, never silently rounded.

export class RuleError extends Error {
  constructor(message: string, public code = 'invalid') { super(message); this.name = 'RuleError'; }
}

const MONEY_RE = /^-?\d{1,15}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,12}(\.\d{1,3})?$/;

/** "1,25,000.50" -> 12500050n paise. Accepts Indian or western grouping. */
export function parseMoney(input: string): bigint {
  const s = String(input).trim().replace(/[,\s₹]/g, '');
  if (!MONEY_RE.test(s)) throw new RuleError(`"${input}" is not a valid amount (use up to 2 decimals)`, 'money');
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const v = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -v : v;
}

export function parseQty(input: string): bigint {
  const s = String(input).trim().replace(/,/g, '');
  if (!QTY_RE.test(s)) throw new RuleError(`"${input}" is not a valid quantity (up to 3 decimals)`, 'qty');
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 1000n + BigInt((frac + '000').slice(0, 3));
}

export function formatQty(milli: bigint): string {
  const neg = milli < 0n; const m = neg ? -milli : milli;
  const whole = m / 1000n; const frac = (m % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Indian digit grouping: 12345678 paise-less rupees -> 1,23,456.78 */
export function formatINR(paise: bigint | number | string, withSymbol = true): string {
  const p = BigInt(paise);
  const neg = p < 0n; const a = neg ? -p : p;
  const rupees = (a / 100n).toString();
  const fr = (a % 100n).toString().padStart(2, '0');
  let g: string;
  if (rupees.length <= 3) g = rupees;
  else { const last3 = rupees.slice(-3); const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ','); g = `${rest},${last3}`; }
  return `${neg ? '-' : ''}${withSymbol ? '₹' : ''}${g}.${fr}`;
}

/** Half-up division of non-negative or negative numerators. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RuleError('division by zero');
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n; const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return neg ? -q : q;
}

/** amount = qty × rate, in paise, half-up (qty in milli-units). */
export function lineAmount(qtyMilli: bigint, ratePaise: bigint): bigint {
  return divRound(qtyMilli * ratePaise, 1000n);
}

/** basis points of an amount, half-up. */
export function bpOf(amount: bigint, bp: number | bigint): bigint {
  return divRound(amount * BigInt(bp), 10000n);
}

export const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
export const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
