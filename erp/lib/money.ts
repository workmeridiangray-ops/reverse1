// Money = integer paise, quantities = integer thousandths. No floating point anywhere in business maths.
export function parseMoney(input: string, label = "Amount"): number {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`${label} must be a positive number with at most 2 decimals (e.g. 1250.50)`);
  const [i, f = ""] = s.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
}
export function parseQty(input: string, label = "Quantity"): number {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Error(`${label} must be a positive number with at most 3 decimals`);
  const [i, f = ""] = s.split(".");
  const v = Number(i) * 1000 + Number((f + "000").slice(0, 3));
  if (v <= 0) throw new Error(`${label} must be greater than zero`);
  return v;
}
export function formatMoney(paise: number | string | null | undefined): string {
  const n = Number(paise ?? 0);
  const neg = n < 0; const a = Math.abs(n);
  const rupees = Math.floor(a / 100); const p = String(a % 100).padStart(2, "0");
  // Indian digit grouping: 12,34,567
  const s = String(rupees);
  const last3 = s.slice(-3); const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}₹${grouped}.${p}`;
}
export function formatQty(milli: number | string | null | undefined): string {
  const n = Number(milli ?? 0);
  const neg = n < 0; const a = Math.abs(n);
  const i = Math.floor(a / 1000); const f = String(a % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${i}${f ? "." + f : ""}`;
}
export function inputQty(milli: number): string { return formatQty(milli); }
export function inputMoney(paise: number): string { return (paise / 100).toFixed(2); }

/** round-half-up integer division for non-negative bigint-safe values */
export function mulDiv(a: number, b: number, d: number): number {
  const r = (BigInt(a) * BigInt(b) * 2n + BigInt(d)) / (BigInt(d) * 2n);
  return Number(r);
}
export interface LineCalc { net: number; tax: number; total: number }
/**
 * qtyBase (thousandths of base unit) priced per selling unit whose size is `factorMilli` base units (1000 = 1:1).
 * Discount and tax in basis points; every step rounds half-up to whole paise.
 */
export function lineAmounts(qtyBase: number, pricePerUomPaise: number, discountBps: number, taxBps: number, factorMilli = 1000): LineCalc {
  const gross = mulDiv(qtyBase, pricePerUomPaise, factorMilli);
  const discount = mulDiv(gross, discountBps, 10000);
  const net = gross - discount;
  const tax = mulDiv(net, taxBps, 10000);
  return { net, tax, total: net + tax };
}
/** cost per BASE unit implied by a price per selling unit */
export function perBase(pricePerUomPaise: number, factorMilli: number): number { return mulDiv(pricePerUomPaise, 1000, factorMilli); }
