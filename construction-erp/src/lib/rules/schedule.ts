export interface Act { id: string; start: string; finish: string }
export interface Dep { pred: string; succ: string; lag: number }
const d = (s: string) => Date.parse(s + 'T00:00:00Z');
const addDays = (s: string, n: number) => new Date(d(s) + n * 86_400_000).toISOString().slice(0, 10);

/** Returns the ids on a dependency cycle, or [] when the graph is acyclic. */
export function findCycle(deps: Dep[]): string[] {
  const g = new Map<string, string[]>();
  for (const e of deps) g.set(e.pred, [...(g.get(e.pred) ?? []), e.succ]);
  const state = new Map<string, 1 | 2>(); const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    state.set(n, 1); stack.push(n);
    for (const m of g.get(n) ?? []) {
      if (state.get(m) === 1) return stack.slice(stack.indexOf(m));
      if (!state.has(m)) { const c = visit(m); if (c) return c; }
    }
    stack.pop(); state.set(n, 2); return null;
  };
  for (const n of g.keys()) if (!state.has(n)) { const c = visit(n); if (c) return c; }
  return [];
}
/** Finish-to-start check: a successor may not start before predecessor finish + lag. */
export function dependencyViolations(acts: Act[], deps: Dep[]) {
  const by = new Map(acts.map(a => [a.id, a]));
  return deps.flatMap(e => {
    const p = by.get(e.pred); const s = by.get(e.succ); if (!p || !s) return [];
    const earliest = addDays(p.finish, e.lag + 1);
    return d(s.start) < d(earliest) ? [{ pred: e.pred, succ: e.succ, earliestStart: earliest }] : [];
  });
}
/** Variance versus baseline in days (positive = late). Baseline itself is never rewritten. */
export function varianceDays(baseFinish: string | null, finish: string): number | null {
  return baseFinish ? Math.round((d(finish) - d(baseFinish)) / 86_400_000) : null;
}
/** Physical progress from a defined rule, never a free-typed percentage. */
export function progressBp(rule: 'quantity' | 'milestone' | 'units', doneMilli: bigint, plannedMilli: bigint, milestoneDone = false): number {
  if (rule === 'milestone') return milestoneDone ? 10000 : 0;
  if (plannedMilli <= 0n) return 0;
  const bp = Number((doneMilli * 10000n) / plannedMilli);
  return Math.min(10000, bp);
}
/** Hold point: work after a hold point on an activity requires a PASSED (or waived with record) inspection. */
export function holdPointBlocks(requiresRelease: boolean, inspections: { hold_point: boolean; status: string }[]): boolean {
  if (!requiresRelease) return false;
  return !inspections.some(i => i.hold_point && (i.status === 'passed' || i.status === 'waived'));
}
