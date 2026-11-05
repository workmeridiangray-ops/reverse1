import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export default async function setup() {
  const url = process.env.BERP_DB_URL;
  if (!url) throw new Error("BERP_DB_URL missing: run `npm run test:db`");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("drop schema if exists public cascade; drop schema if exists app cascade; drop schema if exists auth cascade; create schema public;");
  await c.query("drop role if exists anon; drop role if exists authenticated;");
  await c.query(readFileSync(join(__dirname, "bootstrap.sql"), "utf8"));
  const dir = join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await c.query(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  await c.end();
}
