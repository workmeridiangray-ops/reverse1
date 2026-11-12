import "server-only";
import { Pool, PoolClient, types } from "pg";
import { env } from "./env";

types.setTypeParser(20, (v) => Number(v));      // int8 -> number (paise / milli-units stay far below 2^53)
types.setTypeParser(1082, (v) => v);            // date stays 'YYYY-MM-DD'
types.setTypeParser(1700, (v) => v);

const g = globalThis as unknown as { __erpPool?: Pool };
export const pool: Pool = g.__erpPool ?? (g.__erpPool = new Pool({ connectionString: env.databaseUrl, max: 12, idleTimeoutMillis: 30_000, statement_timeout: 30_000 }));

export type Db = PoolClient;

async function run<T>(setup: (c: PoolClient) => Promise<void>, fn: (db: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await setup(c);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    try { await c.query("rollback"); } catch { /* connection already broken */ }
    throw e;
  } finally { c.release(); }
}

/** Runs fn in one transaction where row-level security exposes only this tenant's business data. */
export function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
  return run(async (c) => {
    if (opts.readOnly) await c.query("set transaction read only");
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  }, fn);
}

/** Control-plane access (identity, billing, platform admin). Cannot see tenant business documents. */
export function withSystem<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return run(async (c) => { await c.query("select set_config('app.system', 'on', true)"); }, fn);
}

/** Tenant context plus control-plane tables (memberships, roles, audit) in one transaction. */
export function withTenantSystem<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return run(async (c) => {
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await c.query("select set_config('app.system', 'on', true)");
  }, fn);
}

export async function one<T = any>(db: Db, sql: string, args: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, args as any[]);
  return (r.rows[0] as T) ?? null;
}
export async function many<T = any>(db: Db, sql: string, args: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, args as any[])).rows as T[];
}
