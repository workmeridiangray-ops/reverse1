/** Money is integer paise. Parse user text strictly; never round silently. */
export function parseRupees(input: string): number {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("Enter an amount like 1250 or 1250.50 (max 2 decimals)");
  const [r, p = ""] = s.split(".");
  return Number(r) * 100 + Number(p.padEnd(2, "0"));
}
export const formatINR = (paise: number | string | bigint): string => {
  const n = Number(paise) / 100;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
/** Round-half-up for rupee-fraction calculations that must produce whole paise. */
export const roundPaise = (x: number) => Math.round(x + Number.EPSILON);
export const GST_RATE = 0.18;
export const gstOn = (paise: number) => roundPaise(paise * GST_RATE);
