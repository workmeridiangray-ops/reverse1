import { formatMoney } from "@/lib/rules/money";
import { formatClock, localDateKey } from "@/lib/rules/time";

export function Money({ minor, currency, className = "" }: { minor: number; currency: string; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{formatMoney(minor, currency)}</span>;
}

export function Clock({ at, timeZone, className = "" }: { at: Date | string; timeZone: string; className?: string }) {
  const d = typeof at === "string" ? new Date(at) : at;
  return (
    <time dateTime={d.toISOString()} className={`font-mono tabular-nums ${className}`}>
      {formatClock(d, timeZone)}
    </time>
  );
}

export function DateText({ at, timeZone }: { at: Date | string; timeZone: string }) {
  const d = typeof at === "string" ? new Date(at) : at;
  const text = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(d);
  return <time dateTime={localDateKey(d, timeZone)}>{text}</time>;
}

export function DateTimeText({ at, timeZone }: { at: Date | string; timeZone: string }) {
  const d = typeof at === "string" ? new Date(at) : at;
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(d);
  return <time dateTime={d.toISOString()}>{text}</time>;
}
