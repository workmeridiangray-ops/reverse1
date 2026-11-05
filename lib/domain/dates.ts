export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const parse = (s: string) => new Date(s + "T00:00:00Z");
export function addDays(s: string, n: number): string { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
/** Subtract n working days; `working` is the set of working weekdays (0=Sun..6=Sat). */
export function subWorkingDays(s: string, n: number, working: ReadonlySet<number>): string {
  let d = s; let left = n;
  if (working.size === 0) return addDays(s, -n);
  while (left > 0) { d = addDays(d, -1); if (working.has(parse(d).getUTCDay())) left--; }
  return d;
}
export function addWorkingDays(s: string, n: number, working: ReadonlySet<number>): string {
  let d = s; let left = n;
  if (working.size === 0) return addDays(s, n);
  while (left > 0) { d = addDays(d, 1); if (working.has(parse(d).getUTCDay())) left--; }
  return d;
}
export const monthOf = (s: string) => s.slice(0, 7);
