/** Parses the lot/serial text boxes used on receiving and dispatch. Pure. */
export type Tracking = "none" | "batch" | "serial";
export type LotInput = { code: string; qty: number; expiry?: string };
const CODE = /^[\x20-\x7E]{1,60}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

/**
 * Receiving:  batch  → one line per lot:  CODE, qty[, YYYY-MM-DD]
 *             serial → one line per unit:  SERIAL[, YYYY-MM-DD]   (commas or spaces also separate serials on one line when no date is used)
 * Dispatch:   same shapes, expiry ignored.
 */
export function parseLots(text: string, tracking: Tracking): { lots: LotInput[]; errors: string[] } {
  const errors: string[] = [], lots: LotInput[] = [], seen = new Set<string>();
  if (tracking === "none") return { lots, errors };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const add = (code: string, qty: number, expiry: string | undefined, n: number) => {
    if (!CODE.test(code)) return void errors.push(`line ${n}: "${code}" is not a valid lot/serial (printable characters, up to 60)`);
    if (seen.has(code.toLowerCase()) && tracking === "serial") return void errors.push(`line ${n}: serial "${code}" is listed twice`);
    if (tracking === "batch" && seen.has(code.toLowerCase())) return void errors.push(`line ${n}: lot "${code}" is listed twice; combine the quantities`);
    seen.add(code.toLowerCase());
    if (expiry !== undefined && !validDate(expiry)) return void errors.push(`line ${n}: expiry must be a real date like 2027-03-31`);
    lots.push(expiry ? { code, qty, expiry } : { code, qty });
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    const parts = line.split(",").map((p) => p.trim());
    if (tracking === "batch") {
      if (parts.length < 2 || parts.length > 3) return void errors.push(`line ${n}: use  LOT, quantity[, expiry]`);
      if (!/^\d+(\.\d{1,3})?$/.test(parts[1]!) || Number(parts[1]) <= 0) return void errors.push(`line ${n}: quantity must be a positive number`);
      add(parts[0]!, Number(parts[1]), parts[2] || undefined, n);
    } else if (parts.length === 2 && DATE.test(parts[1]!)) add(parts[0]!, 1, parts[1], n); // date-shaped second field is an expiry, validated in add()
    else for (const code of parts.flatMap((p) => p.split(/\s+/)).filter(Boolean)) add(code, 1, undefined, n);
  });
  return { lots, errors };
}

export const totalQty = (lots: LotInput[]) => lots.reduce((a, l) => a + l.qty, 0);
