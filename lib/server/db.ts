import "server-only";
import pg from "pg";

declare global { var __pool: pg.Pool | undefined }
export const pool: pg.Pool = globalThis.__pool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX ?? 10), statement_timeout: 30000,
});
if (process.env.NODE_ENV !== "production") globalThis.__pool = pool;
pg.types.setTypeParser(1700, (v) => Number(v));   // numeric → number (quantities; money is bigint paise)
pg.types.setTypeParser(20, (v) => Number(v));     // bigint → number (paise stay < 2^53)
pg.types.setTypeParser(1082, (v) => v);           // date stays 'YYYY-MM-DD'

export type Db = pg.PoolClient;
export type TenantCtx = { companyId: string; userId?: string | null };

/** Run in a transaction. With ctx the transaction is bound to one company: RLS then hides every other company's rows. */
export async function tx<T>(fn: (c: Db) => Promise<T>, ctx?: TenantCtx, opts?: { serializable?: boolean }): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(opts?.serializable ? "begin isolation level repeatable read" : "begin");
    if (ctx) await c.query("select set_config('app.company_id',$1,true), set_config('app.user_id',$2,true)", [ctx.companyId, ctx.userId ?? ""]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { try { await c.query("rollback"); } catch {} throw e; }
  finally { c.release(); }
}
/** Platform-level query (no tenant context): tenant tables return nothing here. */
export const plat = <R extends pg.QueryResultRow = any>(sql: string, p?: unknown[]) => pool.query<R>(sql, p as any[]);

export class UserError extends Error { constructor(msg: string, public code = "invalid") { super(msg); } }
/** Translate DB constraint errors into messages a user can act on. */
export function friendly(e: unknown): string {
  const err = e as { code?: string; message?: string; constraint?: string };
  if (e instanceof UserError) return e.message;
  if (err.code === "P0001") return err.message ?? "Rule violated";
  if (err.code === "23505") return "That already exists (duplicate value).";
  if (err.code === "23503") return "That record is linked to another record that does not exist or cannot be changed.";
  if (err.code === "23514") return "A value is outside the allowed range.";
  if (err.code === "40001") return "Someone else changed this at the same time. Reload and try again.";
  console.error("unexpected error", e);
  return "Something went wrong. Nothing was saved. Please try again.";
}
