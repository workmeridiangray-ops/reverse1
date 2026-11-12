import { NextResponse } from 'next/server';
import { getSession, permSet } from '@/lib/session';
import { withTenant } from '@/lib/db';
import { ENTITIES } from '@/lib/entities';
import { listRows, toCsv, display } from '@/lib/engine';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const s = await getSession();
  if (!s?.ctx) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const u = new URL(req.url); const e = ENTITIES[u.searchParams.get('entity') ?? ''];
  if (!e) return NextResponse.json({ error: 'Unknown record type.' }, { status: 404 });
  const perms = await permSet(s);
  if (!perms.has(`${e.module === 'project' ? 'reports' : e.module}:export`)) return NextResponse.json({ error: 'You do not have permission to export this.' }, { status: 403 });
  const pid = e.scoped ? u.searchParams.get('project') : null;
  const out = await withTenant(s.ctx, async q => {
    const all: any[] = [];
    for (let page = 1; page <= 40; page++) { const r = await listRows(q, e, pid, { q: u.searchParams.get('q') ?? undefined, status: u.searchParams.get('status') ?? undefined, sort: u.searchParams.get('sort') ?? undefined, dir: u.searchParams.get('dir') ?? undefined, page }); all.push(...r.rows); if (page >= r.pages) break; }
    await audit(q, { orgId: s.org!.id, actorId: s.user.id, role: s.ctx!.role, action: 'export.entity', entity: e.table, detail: { rows: all.length } });
    return all;
  });
  const cols = e.fields.filter(f => f.t !== 'area').map(f => ({ key: f.n, label: f.l }));
  const rows = out.map(r => Object.fromEntries(e.fields.map(f => [f.n, display(f, r[f.n], r[`${f.n}__l`])])));
  return new NextResponse(toCsv(rows, cols), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${e.key}.csv"`, 'Cache-Control': 'private, no-store' } });
}
