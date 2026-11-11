// Loads supabase/demo_history.sql into the LOCAL database (optional demo data for the analytics page).
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error("Refusing to load demo data into a non-local database.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(readFileSync(new URL("../supabase/demo_history.sql", import.meta.url), "utf8"));
const { rows } = await client.query(`select (select count(*) from public.appointments where reason like 'DEMO %') as visits,
  (select count(*) from public.invoices where number like 'INV-D%') as invoices, (select count(*) from public.lab_orders where clinical_notes = 'demo-history') as lab_orders`);
console.log("Demo history loaded:", rows[0]);
await client.end();
