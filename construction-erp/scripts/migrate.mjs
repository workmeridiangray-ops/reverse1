// Applies db/migrations/*.sql in order, once each, as the OWNER role.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('DATABASE_URL_OWNER is required'); process.exit(1); }
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
const done = new Set((await client.query('select name from schema_migrations')).rows.map(r => r.name));
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  process.stdout.write(`applying ${f} ... `);
  try {
    await client.query('begin');
    await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await client.query('insert into schema_migrations(name) values ($1)', [f]);
    await client.query('commit');
    console.log('ok');
  } catch (e) { await client.query('rollback'); console.log('FAILED'); console.error(e.message); process.exit(1); }
}
await client.end();
