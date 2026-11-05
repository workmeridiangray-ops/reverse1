import { formatMoney } from "@/lib/rules/money";
import { formatQty } from "@/lib/rules/qty";

export function Money({ minor, currency = "INR", className = "" }: { minor: number; currency?: string; className?: string }) {
  return <span className={`whitespace-nowrap font-mono tabular-nums ${className}`}>{formatMoney(minor, currency, currency === "INR" ? "en-IN" : "en-US")}</span>;
}
export function Qty({ milli, unit }: { milli: number; unit?: string }) {
  return <span className="whitespace-nowrap font-mono tabular-nums">{formatQty(milli)}{unit ? ` ${unit}` : ""}</span>;
}
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const fmtT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function DateText({ at }: { at: Date | string | null | undefined }) {
  if (!at) return <span className="text-ink-500">—</span>;
  const d = typeof at === "string" ? new Date(at.length === 10 ? `${at}T00:00:00+05:30` : at) : at;
  return <time dateTime={d.toISOString()}>{fmt.format(d)}</time>;
}
export function DateTimeText({ at }: { at: Date | string | null | undefined }) {
  if (!at) return <span className="text-ink-500">—</span>;
  const d = typeof at === "string" ? new Date(at) : at;
  return <time dateTime={d.toISOString()}>{fmtT.format(d)} IST</time>;
}
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
