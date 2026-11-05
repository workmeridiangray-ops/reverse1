import "server-only";
import { plat, pool } from "./db";

export async function enqueue(kind: string, payload: Record<string, unknown>, dedupeKey?: string, runAt?: Date, companyId?: string) {
  await plat("insert into jobs(kind,payload,dedupe_key,run_at,company_id) values ($1,$2,$3,coalesce($4,now()),$5) on conflict (dedupe_key) do nothing", [kind, JSON.stringify(payload), dedupeKey ?? null, runAt ?? null, companyId ?? null]);
}
type Handler = (payload: any) => Promise<void>;
const handlers: Record<string, Handler> = {};
export const registerJob = (kind: string, h: Handler) => { handlers[kind] = h; };

/** Claims due jobs with SKIP LOCKED so several workers can run safely; bounded retries with exponential backoff. */
export async function runDueJobs(limit = 20): Promise<{ done: number; failed: number }> {
  await import("./handlers");
  let done = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const c = await pool.connect();
    let job: any;
    try {
      await c.query("begin");
      job = (await c.query("select * from jobs where status in ('queued') and run_at <= now() order by run_at limit 1 for update skip locked")).rows[0];
      if (!job) { await c.query("commit"); break; }
      await c.query("update jobs set status='running', attempts=attempts+1 where id=$1", [job.id]);
      await c.query("commit");
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    try {
      const h = handlers[job.kind]; if (!h) throw new Error(`No handler for ${job.kind}`);
      await h(job.payload);
      await plat("update jobs set status='done', finished_at=now(), last_error=null where id=$1", [job.id]); done++;
    } catch (e) {
      const dead = job.attempts + 1 >= job.max_attempts;
      await plat("update jobs set status=$2, last_error=$3, run_at=now()+($4 || ' seconds')::interval where id=$1", [job.id, dead ? "dead" : "queued", String(e).slice(0, 500), String(Math.min(3600, 30 * 2 ** job.attempts))]); failed++;
    }
  }
  return { done, failed };
}
/** Safe manual retry for failed/dead jobs. */
export async function retryJob(id: string) { await plat("update jobs set status='queued', run_at=now(), attempts=0 where id=$1 and status in ('failed','dead')", [id]); }
