import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
export const dynamic = 'force-dynamic';
/** Liveness + database readiness. No secrets, no tenant data. */
export async function GET() {
  try {
    const r = await pool.query('select 1 as ok, (select count(*) from schema_migrations) as migrations');
    return NextResponse.json({ status: 'ok', db: 'up', migrations: Number(r.rows[0].migrations), time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: 'degraded', db: 'down' }, { status: 503 });
  }
}
