import { execFileSync } from "node:child_process";
import pg from "pg";

pg.types.setTypeParser(20, (v) => Number(v));
/** OWNER_URL points at a server where the test may create/drop the `erp_test` database. */
const OWNER = process.env.TEST_OWNER_URL ?? "postgresql://postgres@localhost:5433/postgres?host=/tmp/pgdata";
const dbUrl = (u: string, db: string) => { const x = new URL(u); x.pathname = `/${db}`; return x.toString(); };
export const TEST_DB = "erp_test";

export async function freshDatabase() {
  const admin = new pg.Client({ connectionString: OWNER });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: dbUrl(OWNER, TEST_DB), ERP_APP_PASSWORD: "apppw" }, stdio: "pipe" });
}
export const ownerClient = () => new pg.Client({ connectionString: dbUrl(OWNER, TEST_DB) });
export const appPool = () => { const x = new URL(dbUrl(OWNER, TEST_DB)); x.username = "erp_app"; x.password = "apppw"; return new pg.Pool({ connectionString: x.toString(), max: 8 }); };

export interface Scope { tenantId?: string; userId?: string; role?: string; allProjects?: boolean; platform?: boolean }
export async function asScope<T>(pool: pg.Pool, s: Scope, fn: (q: (sql: string, p?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true), set_config('app.role',$3,true), set_config('app.all_projects',$4,true), set_config('app.platform',$5,true)",
      [s.tenantId ?? "", s.userId ?? "", s.role ?? "", s.allProjects === false ? "off" : "on", s.platform ? "on" : "off"]);
    const r = await fn((sql, p) => c.query(sql, p));
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
}
