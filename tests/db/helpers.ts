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
  owen: "a2000000-0000-4000-8000-000000000006",
  sofia: "a2000000-0000-4000-8000-000000000005",
  allergyAmal: "c1000000-0000-4000-8000-000000000001",
  nkdaGeorge: "c1000000-0000-4000-8000-000000000002",
  allergyOwen: "c1000000-0000-4000-8000-000000000003",
  typeHb: "a7000000-0000-4000-8000-000000000001",
  typeK: "a7000000-0000-4000-8000-000000000002",
  typeFerr: "a7000000-0000-4000-8000-000000000003",
  typeGlu: "a7000000-0000-4000-8000-000000000004",
  typeHbB: "b7000000-0000-4000-8000-000000000001",
  orderAmal: "a9000000-0000-4000-8000-000000000001",
  orderRavi: "a9000000-0000-4000-8000-000000000002",
  orderGeorge: "a9000000-0000-4000-8000-000000000003",
  orderJon: "b9000000-0000-4000-8000-000000000001",
  resHbAmal: "ca000000-0000-4000-8000-000000000001",
  resFerrAmal: "ca000000-0000-4000-8000-000000000002",
  resKRavi: "ca000000-0000-4000-8000-000000000003",
  resGluGeorge: "ca000000-0000-4000-8000-000000000004",
  resHbJon: "cb000000-0000-4000-8000-000000000001",
  rangeHbFemale: "a8000000-0000-4000-8000-000000000001",
  rangeKAny: "a8000000-0000-4000-8000-000000000003",
  rangeGluAny: "a8000000-0000-4000-8000-000000000006",
  rangeHbFemaleB: "b8000000-0000-4000-8000-000000000001",
  rxParacetamol: "a5000000-0000-4000-8000-000000000003",
  prodAmox: "d1000000-0000-4000-8000-000000000001",
  prodFerrous: "d1000000-0000-4000-8000-000000000002",
  prodParacetamol: "d1000000-0000-4000-8000-000000000003",
  prodIbuprofen: "d1000000-0000-4000-8000-000000000004",
  prodParacetamolB: "e1000000-0000-4000-8000-000000000001",
  batchF101: "d2000000-0000-4000-8000-000000000001",
  batchF102: "d2000000-0000-4000-8000-000000000002",
  batchAmx: "d2000000-0000-4000-8000-000000000003",
  batchP1Expired: "d2000000-0000-4000-8000-000000000004",
  batchP2: "d2000000-0000-4000-8000-000000000005",
  batchP3Quarantined: "d2000000-0000-4000-8000-000000000006",
  batchN1: "e2000000-0000-4000-8000-000000000001",
  requestAmal: "f1000000-0000-4000-8000-000000000001",
  requestJon: "f1000000-0000-4000-8000-000000000002",
} as const;

export type Q = <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<T[]>;

async function inTx<T>(setup: string[], fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const s of setup) await client.query(s);
    const q: Q = async <R>(sql: string, params?: readonly unknown[]) => (await client.query(sql, params as unknown[])).rows as R[];
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
export async function attempt(q: Q, sql: string, params?: readonly unknown[]): Promise<{ ok: boolean; rows: number; error?: string }> {
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

/** Switch the signed-in user inside an open transaction (null = back to the database owner). */
export async function act(q: Q, user: UserKey | null): Promise<void> {
  if (user === null) {
    await q("reset role");
    return;
  }
  await q("reset role");
  await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U[user], role: "authenticated", aud: "authenticated" })]);
  await q("set local role authenticated");
}

/** Start as the database owner (to arrange data), then `act()` as users. Always rolled back. */
export function scenario<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return asOwner(fn);
}

/** Run `fn`, report what it saw, then undo its writes (so one test can probe many what-ifs). */
export async function probe<T>(q: Q, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  await q("savepoint probe");
  try {
    const value = await fn();
    await q("rollback to savepoint probe");
    return { ok: true, value };
  } catch (e) {
    await q("rollback to savepoint probe");
    return { ok: false, error: (e as Error).message };
  }
}

/** Run `fn` and KEEP its writes (inside the test's rolled-back transaction); report errors without aborting the transaction. */
export async function commitStep<T>(q: Q, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  await q("savepoint step");
  try {
    const value = await fn();
    await q("release savepoint step");
    return { ok: true, value };
  } catch (e) {
    await q("rollback to savepoint step");
    return { ok: false, error: (e as Error).message };
  }
}
