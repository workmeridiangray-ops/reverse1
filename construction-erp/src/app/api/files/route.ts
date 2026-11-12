import { NextResponse } from 'next/server';
import { getSession, hasPerm } from '@/lib/session';
import { withTenant, one } from '@/lib/db';
import { validateUpload, putObject, deleteObject } from '@/lib/storage';
import { audit } from '@/lib/audit';
import { checkEntitlement } from '@/lib/rules/plan';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const s = await getSession();
  if (!s?.ctx || !s.org) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (s.ctx.role === 'support' || s.org.status === 'suspended') return NextResponse.json({ error: 'Uploads are not allowed for this workspace.' }, { status: 403 });
  if (s.sub && ['expired', 'cancelled'].includes(s.sub.state)) return NextResponse.json({ error: 'Your subscription has ended, so the workspace is read-only.' }, { status: 403 });
  let fd: FormData;
  try { fd = await req.formData(); } catch { return NextResponse.json({ error: 'The upload was interrupted. Please retry.' }, { status: 400 }); }
  const file = fd.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file.' }, { status: 400 });
  try {
    const data = Buffer.from(await file.arrayBuffer());
    const { mime, safeName } = validateUpload(file.name, file.type, data);
    const project = String(fd.get('project') ?? '') || null;
    const entityType = String(fd.get('entityType') ?? '') || null; const entityId = String(fd.get('entityId') ?? '') || null;
    const restricted = fd.get('restricted') === '1';
    const external = ['client', 'consultant', 'contractor'].includes(s.ctx.role);
    if (external) return NextResponse.json({ error: 'You do not have permission to upload here.' }, { status: 403 });
    if (!(await hasPerm(s, project ? 'project:create' : 'settings:view')) && !(await hasPerm(s, 'site:create')) && !(await hasPerm(s, 'quality:create')) && !(await hasPerm(s, 'drawings:create')))
      return NextResponse.json({ error: 'You do not have permission to upload files.' }, { status: 403 });
    const stored = await withTenant(s.ctx, async q => {
      if (project) { const p = await one<any>(q, 'select id from projects where id = $1', [project]); if (!p) throw Object.assign(new Error('Project not found.'), { status: 404 }); }
      const u = (await one<any>(q, 'select org_usage($1) u', [s.org!.id]))!.u;
      checkEntitlement(s.sub?.limits ?? { users: 1e9, projects: 1e9, storage_mb: 1e9, branches: 1e9 }, u, 'storage_mb', Math.ceil(data.length / 1048576));
      const obj = await putObject(s.org!.id, data);
      try {
        const f = (await one<any>(q, `insert into files(org_id, project_id, name, mime, size_bytes, sha256, storage_key, kind, restricted, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [s.org!.id, project, safeName, mime, data.length, obj.sha256, obj.key, String(fd.get('kind') ?? 'document'), restricted, s.user.id]))!;
        if (entityType && entityId && /^[a-z_]+$/.test(entityType)) await q.query(`insert into documents(org_id, project_id, entity_type, entity_id, kind, title, file_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [s.org!.id, project, entityType, entityId, String(fd.get('kind') ?? 'document'), safeName, f.id, s.user.id]);
        await audit(q, { orgId: s.org!.id, actorId: s.user.id, role: s.ctx!.role, action: 'file.upload', entity: 'files', entityId: f.id, detail: { size: data.length, mime } });
        return { id: f.id as string, name: safeName };
      } catch (e) { await deleteObject(obj.key).catch(() => {}); throw e; }
    });
    return NextResponse.json(stored);
  } catch (e: any) {
    const status = e?.status ?? (e?.code === 'upload' ? 400 : e?.code === 'plan_limit' ? 402 : 400);
    return NextResponse.json({ error: e?.message ?? 'Upload failed.' }, { status });
  }
}
