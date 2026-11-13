/** Schedule rules (pure): finish-to-start dependency checks, cycle detection, lookahead, baseline variance. */
export interface Act { id: string; start: string; end: string; deps: string[]; }
export class ScheduleError extends Error { override name = "ScheduleError"; }

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86400000);

/** Would `deps` create a cycle if `id` depended on them? */
export function wouldCycle(all: Act[], id: string, deps: string[]): boolean {
  const next = new Map(all.map((a) => [a.id, a.deps]));
  next.set(id, deps);
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === id) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

/** Validate one activity against its predecessors (finish-to-start). Returns the problems found. */
export function validateActivity(a: Act, all: Act[]): string[] {
  const out: string[] = [];
  if (a.end < a.start) out.push("Finish date cannot be before the start date.");
  if (a.deps.includes(a.id)) out.push("An activity cannot depend on itself.");
  const by = new Map(all.map((x) => [x.id, x]));
  for (const d of a.deps) {
    const p = by.get(d);
    if (!p) { out.push("A predecessor does not exist in this project."); continue; }
    if (a.start < p.end) out.push(`Starts before its predecessor finishes (${p.end}).`);
  }
  if (wouldCycle(all, a.id, a.deps)) out.push("These dependencies form a loop.");
  return out;
}

export const inLookahead = (a: { start: string; end: string }, today: string, weeks = 3) => {
  const horizon = new Date(day(today) + weeks * 7 * 86400000).toISOString().slice(0, 10);
  return a.end >= today && a.start <= horizon;
};
/** Positive = finishing later than the baseline. */
export const slipDays = (a: { end: string; baseEnd: string | null }) => (a.baseEnd ? daysBetween(a.baseEnd, a.end) : 0);
