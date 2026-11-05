/**
 * Money and quantity rules. Pure: no clock, env or network.
 * PARITY: must agree with app.line_net / app.line_tax in supabase/migrations (tests/db/03-parity).
 * Money is integer paise; quantities have at most 3 decimals and are handled as integer thousandths.
 */

/** Half-up rounding of a non-negative rational n/d using integer maths. */
function divRound(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

/** "12.345" → 12345n thousandths. Rejects more than 3 decimals or negatives. */
export function toMilli(q: number | string): bigint {
  const s = String(q).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Error(`invalid quantity: ${s}`);
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 1000n + BigInt(f.padEnd(3, "0"));
}

/** net = round(round(qty × price) × (1 − discount)); discount in basis points. */
export function lineNet(qty: number | string, pricePaise: number, discountBp = 0): number {
  if (discountBp < 0 || discountBp > 10000) throw new Error("discount out of range");
  const gross = divRound(toMilli(qty) * BigInt(pricePaise), 1000n);
  return Number(divRound(gross * BigInt(10000 - discountBp), 10000n));
}

export function lineTax(netPaise: number, rateBp: number): number {
  return Number(divRound(BigInt(netPaise) * BigInt(rateBp), 10000n));
}

export type Line = { qty: number | string; pricePaise: number; discountBp?: number; taxRateBp?: number };

export function totals(lines: Line[]) {
  let subtotal = 0, tax = 0;
  for (const l of lines) {
    const net = lineNet(l.qty, l.pricePaise, l.discountBp ?? 0);
    subtotal += net;
    tax += lineTax(net, l.taxRateBp ?? 0);
  }
  return { subtotal, tax, total: subtotal + tax };
}

/** Indian digit grouping: 1234567 paise → ₹12,345.67 */
export function formatInr(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const r = String(rupees);
  const last3 = r.slice(-3);
  const rest = r.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}₹${grouped}.${frac}`;
}

/** "1234.50" → 123450. Throws on anything that is not a plain amount with ≤ 2 decimals. */
export function parseInr(input: string): number {
  const s = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`invalid amount: ${input}`);
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/** A bill is within tolerance when |billed − expected| ≤ round(expected × tolBp / 10000). */
export function withinTolerance(billed: number, expected: number, tolBp: number): boolean {
  return Math.abs(billed - expected) <= Number(divRound(BigInt(expected) * BigInt(tolBp), 10000n));
}

export type Availability = { onHand: number; reserved: number };
export const available = (s: Availability) => s.onHand - s.reserved;

export type InvoiceStatus = "posted" | "partially_paid" | "paid" | "reversed";
export function invoiceStatus(total: number, paid: number): Exclude<InvoiceStatus, "reversed"> {
  if (paid < 0 || paid > total) throw new Error("paid outside 0..total");
  return paid === total ? "paid" : paid > 0 ? "partially_paid" : "posted";
}

/** Splits a receipt across open invoices oldest-first. Returns allocations and any unapplied remainder. */
export function allocateOldestFirst(amount: number, open: { id: string; balance: number }[]) {
  let left = amount;
  const allocations: { invoiceId: string; amount: number }[] = [];
  for (const inv of open) {
    if (left <= 0) break;
    const a = Math.min(left, inv.balance);
    if (a > 0) { allocations.push({ invoiceId: inv.id, amount: a }); left -= a; }
  }
  return { allocations, unapplied: left };
}
