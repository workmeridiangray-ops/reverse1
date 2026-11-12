import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Fresh schema on the dedicated test database before every run.
export default async function setup() {
  const admin = new Client({ connectionString: process.env.TEST_OWNER_URL ?? "postgresql://erp_owner:erp_owner_pw@127.0.0.1:5432/erp_test" });
  await admin.connect();
  await admin.query("drop schema public cascade; create schema public;");
  await admin.query("grant usage on schema public to erp_app");
  const dir = join(process.cwd(), "db", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await admin.query(readFileSync(join(dir, f), "utf8"));
  await admin.end();
}
