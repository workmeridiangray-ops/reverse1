import type { Db } from "./db";
import { withSystem } from "./db";

export type JobHandler = (payload: any, job: { id: string; attempts: number; tenant_id: string | null }) => Promise<void>;
const handlers: Record<string, JobHandler> = {};
export function registerJob(kind: string, h: JobHandler) { handlers[kind] = h; }

export async function enqueue(db: Db, kind: string, payload: object, opts: { tenantId?: string | null; dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {}): Promise<void> {
  await db.query(
    `insert into jobs(kind, payload, tenant_id, dedupe_key, run_at, max_attempts) values ($1,$2,$3,$4,coalesce($5, now()),$6)
     on conflict (dedupe_key) do nothing`,
    [kind, JSON.stringify(payload), opts.tenantId ?? null, opts.dedupeKey ?? null, opts.runAt ?? null, opts.maxAttempts ?? 5],
  );
}

/** Claims due jobs with SKIP LOCKED so several workers never run the same job; bounded retries with backoff. */
export async function processJobs(limit = 20): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await withSystem(async (db) => {
      const r = await db.query(
        `update jobs set status='running', locked_at=now(), attempts=attempts+1 where id = (
           select id from jobs where (status in ('queued','failed') and run_at <= now())
              or (status='running' and locked_at < now() - interval '10 minutes')
           order by run_at for update skip locked limit 1) returning *`);
      return r.rows[0] ?? null;
    });
    if (!job) break;
    try {
      const h = handlers[job.kind];
      if (!h) throw new Error(`no handler for job kind ${job.kind}`);
      await h(job.payload, job);
      await withSystem((db) => db.query("update jobs set status='done', finished_at=now(), last_error=null where id=$1", [job.id]));
      done++;
    } catch (e: any) {
      failed++;
      const dead = job.attempts >= job.max_attempts;
      const delaySec = Math.min(3600, 30 * 2 ** (job.attempts - 1));
      await withSystem((db) => db.query(
        `update jobs set status=$2, last_error=$3, run_at = now() + ($4 || ' seconds')::interval, finished_at = case when $2='dead' then now() end where id=$1`,
        [job.id, dead ? "dead" : "failed", String(e?.message ?? e).slice(0, 500), String(delaySec)]));
    }
  }
  return { done, failed };
}

/** Safe manual retry from the platform console: only failed/dead jobs, never re-runs a completed one. */
export async function retryJob(db: Db, id: string): Promise<boolean> {
  const r = await db.query("update jobs set status='queued', run_at=now(), attempts=0, last_error=null where id=$1 and status in ('failed','dead')", [id]);
  return (r.rowCount ?? 0) > 0;
}
