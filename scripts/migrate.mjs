// Applies db/migrations/*.sql in order, once each, as the OWNER role (DATABASE_URL).
// Then (optionally) sets the app role's password from ERP_APP_PASSWORD so it can log in.
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL (owner connection) is required"); process.exit(1); }
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
await client.query("SELECT pg_advisory_lock(727274)");
const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
const dir = new URL("../db/migrations/", import.meta.url);
for (const f of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  const sql = await readFile(new URL(f, dir), "utf8");
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
    await client.query("COMMIT");
    console.log("applied", f);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("FAILED", f, e.message);
    process.exit(1);
  }
}
if (process.env.ERP_APP_PASSWORD) {
  const pw = process.env.ERP_APP_PASSWORD.replace(/'/g, "''");
  await client.query(`ALTER ROLE erp_app LOGIN PASSWORD '${pw}'`);
  console.log("erp_app role can log in");
}
await client.end();
