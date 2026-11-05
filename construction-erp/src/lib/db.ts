import 'server-only';
import pg from 'pg';
import { env } from './env';

// numeric -> string (exact), bigint -> string (exact). We never let JS floats touch money.
pg.types.setTypeParser(1700, v => v);
pg.types.setTypeParser(20, v => v);

declare global { var __pool: pg.Pool | undefined }
export const pool: pg.Pool = globalThis.__pool ?? new pg.Pool({ connectionString: env.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
if (!env.isProd) globalThis.__pool = pool;

export interface Ctx {
  userId: string;
  orgId: string | null;
  role: string;                 // owner|manager|...|client|consultant|contractor|platform|system|support
  partyId?: string | null;
  sensitive?: string[];
  ip?: string | null;
}
export type Q = pg.PoolClient;

async function setCtx(c: pg.PoolClient, ctx: Ctx) {
  await c.query(
    `select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true),
            set_config('app.party_id', $4, true), set_config('app.sensitive', $5, true)`,
    [ctx.orgId ?? '', ctx.userId ?? '', ctx.role, ctx.partyId ?? '', (ctx.sensitive ?? []).join(',')],
  );
}

/** Run fn in ONE transaction with the tenant context applied; row-level security does the rest. */
export async function withTenant<T>(ctx: Ctx, fn: (q: Q) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await setCtx(c, ctx);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/** For identity/session/platform tables that are not tenant data. */
export async function withSystem<T>(fn: (q: Q) => Promise<T>, orgId: string | null = null): Promise<T> {
  return withTenant({ userId: '', orgId, role: 'system' }, fn);
}

export async function one<T = Record<string, any>>(q: Q, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query(sql, params); return (r.rows[0] as T) ?? null;
}
export async function many<T = Record<string, any>>(q: Q, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query(sql, params)).rows as T[];
}

export class AppError extends Error {
  constructor(message: string, public code: string = 'error', public status = 400) { super(message); }
}
/** Translate database errors into messages a person can act on. */
export function friendly(e: unknown): string {
  const err = e as any;
  if (err instanceof AppError) return err.message;
  if (err?.name === 'RuleError') return err.message;
  switch (err?.code) {
    case '23505': return 'That already exists (duplicate). Check the reference or number and try again.';
    case '23503': return err.message?.includes('cross-tenant') ? 'That record is not available to you.' : 'A linked record is missing or still in use.';
    case '23514': return err.message?.replace(/^.*?: /, '') || 'A value is outside the allowed range.';
    case '42501': return err.message?.includes('row-level security') ? 'You do not have permission to do that.' : (err.message || 'You do not have permission to do that.');
    case '55000': return err.message;
    case '22P02': return 'One of the values has the wrong format.';
  }
  console.error('[unexpected]', err?.message);
  return 'Something went wrong. Nothing was saved — please try again.';
}
