import pg from "pg";
import fs from "node:fs";
import path from "node:path";
/** Builds a fresh mfg_test database from the real migrations before each run. */
export default async function setup() {
  const admin = process.env.TEST_ADMIN_URL ?? "postgres://mfg_owner:owner@localhost/postgres";
  const a = new pg.Client({ connectionString: admin }); await a.connect();
  await a.query("drop database if exists mfg_test with (force)"); await a.query("create database mfg_test owner mfg_owner"); await a.end();
  const c = new pg.Client({ connectionString: admin.replace(/\/postgres$/, "/mfg_test") }); await c.connect();
  const dir = path.resolve("db/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
  await c.end();
}
