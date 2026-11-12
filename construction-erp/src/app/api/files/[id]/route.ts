import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { withTenant, one } from '@/lib/db';
import { getObject } from '@/lib/storage';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';

/** Files are never public: every download is checked against the caller's workspace, project scope and restrictions by row-level security. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s?.ctx) return NextResponse.json({ error: 'Sign in to download files.' }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const f = await withTenant(s.ctx, q => one<any>(q, `select * from files where id = $1 and status = 'stored'`, [id]));
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });   // same answer for "other tenant" and "does not exist"
  await withTenant(s.ctx, q => audit(q, { orgId: s.org!.id, actorId: s.user.id, role: s.ctx!.role, action: 'file.download', entity: 'files', entityId: id })).catch(() => {});
  const data = await getObject(f.storage_key);
  const inline = new URL(req.url).searchParams.get('inline') === '1' && ['image/jpeg', 'image/png'].includes(f.mime);
  return new NextResponse(new Uint8Array(data), { headers: { 'Content-Type': f.mime, 'Content-Length': String(data.length), 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/"/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
}
