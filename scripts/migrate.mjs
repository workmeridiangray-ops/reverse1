// Applies db/migrations/*.sql in order, once each, using MIGRATE_DATABASE_URL (owner role).
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("Set MIGRATE_DATABASE_URL"); process.exit(1); }
const dir = path.resolve("db/migrations");
const c = new pg.Client({ connectionString: url });
await c.connect();
// Managed hosts give only an owner login: create the restricted runtime role (no superuser, no BYPASSRLS) before migrating.
if (process.env.APP_DB_PASSWORD) {
  const pw = process.env.APP_DB_PASSWORD.replace(/'/g, "''");
  const r = await c.query("select 1 from pg_roles where rolname='mfg_app'");
  if (!r.rowCount) await c.query(`create role mfg_app login password '${pw}' nosuperuser nobypassrls`);
  else await c.query(`alter role mfg_app password '${pw}'`);
}
await c.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  const done = await c.query("select 1 from schema_migrations where name=$1", [f]);
  if (done.rowCount) continue;
  console.log("applying", f);
  await c.query("begin");
  try { await c.query(fs.readFileSync(path.join(dir, f), "utf8")); await c.query("insert into schema_migrations(name) values ($1)", [f]); await c.query("commit"); }
  catch (e) { await c.query("rollback"); console.error("FAILED", f, e.message); process.exit(1); }
}
await c.end(); console.log("migrations up to date");
