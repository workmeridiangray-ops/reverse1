/**
 * The database tests assert exact row counts against the baseline seed. If the
 * optional demo history (npm run db:seed-demo-history) is loaded, those counts
 * are wrong for a reason that has nothing to do with the code, so stop early
 * with a clear instruction instead of a wall of confusing failures.
 */
import { beforeAll } from "vitest";
import pg from "pg";

beforeAll(async () => {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await client.connect();
  try {
    const { rows } = await client.query(`select count(*)::int as n from public.appointments where reason like 'DEMO %'`);
    if ((rows[0]?.n ?? 0) > 0) throw new Error("Demo history is loaded. Run `npm run db:reset` to restore the baseline seed before running the database tests.");
  } finally {
    await client.end();
  }
});
