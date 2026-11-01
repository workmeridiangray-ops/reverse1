/**
 * Test harness for running queries as a real Supabase user against the local
 * Supabase Postgres (started with `npm run db:start`).
 *
 * `as(user, fn)` opens a transaction, switches to the `authenticated` role and
 * sets `request.jwt.claims` exactly as PostgREST does for a signed-in request,
 * so auth.uid() and every RLS policy behave as in production. The transaction
 * is always rolled back, so tests never leave data behind.
 */
import pg from "pg";

// Return bigint/numeric as JS numbers in tests (values are well within range).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });

export const CLINIC_A = "aaaaaaaa-0000-4000-8000-000000000000";
export const CLINIC_B = "bbbbbbbb-0000-4000-8000-000000000000";

export const U = {
  adminA: "a0000000-0000-4000-8000-000000000001",
  doctorA: "a0000000-0000-4000-8000-000000000002",
  doctorA2: "a0000000-0000-4000-8000-000000000003",
  deskA: "a0000000-0000-4000-8000-000000000004",
  labA: "a0000000-0000-4000-8000-000000000005",
  pharmA: "a0000000-0000-4000-8000-000000000006",
  patientA: "a0000000-0000-4000-8000-000000000007",
  inactiveDeskA: "a0000000-0000-4000-8000-000000000008",
  adminB: "b0000000-0000-4000-8000-000000000001",
  doctorB: "b0000000-0000-4000-8000-000000000002",
  deskB: "b0000000-0000-4000-8000-000000000004",
  patientB: "b0000000-0000-4000-8000-000000000007",
} as const;
export type UserKey = keyof typeof U;

export const ID = {
  amal: "a2000000-0000-4000-8000-000000000001",
  george: "a2000000-0000-4000-8000-000000000002",
  ravi: "a2000000-0000-4000-8000-000000000004",
  jon: "b2000000-0000-4000-8000-000000000001",
  roomA1: "a1000000-0000-4000-8000-000000000001",
  roomA2: "a1000000-0000-4000-8000-000000000002",
  roomB: "b1000000-0000-4000-8000-000000000001",
  apptAmalToday: "a3000000-0000-4000-8000-000000000002",
  apptRaviInRoom: "a3000000-0000-4000-8000-000000000003",
  apptOwenWaiting: "a3000000-0000-4000-8000-000000000004",
  apptSofiaExpected: "a3000000-0000-4000-8000-000000000006",
  apptJon: "b3000000-0000-4000-8000-000000000001",
  consultUnsigned: "a4000000-0000-4000-8000-000000000001",
  consultSigned: "a4000000-0000-4000-8000-000000000002",
  consultCritical: "a4000000-0000-4000-8000-000000000003",
  consultB: "b4000000-0000-4000-8000-000000000001",
  rxActive: "a5000000-0000-4000-8000-000000000001",
  rxDraft: "a5000000-0000-4000-8000-000000000002",
  invAmal: "a6000000-0000-4000-8000-000000000001",
  invGeorge: "a6000000-0000-4000-8000-000000000002",
  invRaviDraft: "a6000000-0000-4000-8000-000000000003",
  invJon: "b6000000-0000-4000-8000-000000000001",
} as const;

export type Q = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

async function inTx<T>(setup: string[], fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const s of setup) await client.query(s);
    const q: Q = async <R>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as R[];
    return await fn(q);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Run `fn` as a signed-in user. Always rolled back. */
export function as<T>(user: UserKey | null, fn: (q: Q) => Promise<T>): Promise<T> {
  const claims = user ? JSON.stringify({ sub: U[user], role: "authenticated", aud: "authenticated" }) : "{}";
  return inTx(
    [
      `set local role ${user ? "authenticated" : "anon"}`,
      `select set_config('request.jwt.claims', '${claims}', true)`,
    ],
    fn,
  );
}

/** Run `fn` as the database owner (bypasses RLS). Always rolled back. */
export function asOwner<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return inTx([], fn);
}

/** Expect a statement to fail; returns the Postgres error message. */
export async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("Expected the statement to fail, but it succeeded");
}

/** Run a write inside a savepoint so a failure does not abort the test transaction. */
export async function attempt(q: Q, sql: string, params?: unknown[]): Promise<{ ok: boolean; rows: number; error?: string }> {
  await q("savepoint t");
  try {
    const rows = await q(sql, params);
    await q("release savepoint t");
    return { ok: true, rows: rows.length };
  } catch (e) {
    await q("rollback to savepoint t");
    return { ok: false, rows: 0, error: (e as Error).message };
  }
}
