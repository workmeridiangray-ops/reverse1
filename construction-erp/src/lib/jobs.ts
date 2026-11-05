import type { Q } from './db';

export async function enqueue(q: Q, kind: string, payload: Record<string, unknown>, opts: { orgId?: string | null; dedupeKey?: string; runAt?: Date } = {}) {
  await q.query(
    `insert into jobs(kind, payload, org_id, dedupe_key, run_at) values ($1,$2,$3,$4,$5) on conflict (dedupe_key) do nothing`,
    [kind, JSON.stringify(payload), opts.orgId ?? null, opts.dedupeKey ?? null, opts.runAt ?? new Date()],
  );
}
/** Exponential backoff with a bounded number of attempts. */
export const backoffSeconds = (attempt: number) => Math.min(3600, 30 * 2 ** (attempt - 1));
