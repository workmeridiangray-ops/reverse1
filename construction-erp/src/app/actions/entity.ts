'use server';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/ActionForm';
import { run, getSession } from '@/lib/session';
import { withTenant, one, many, AppError } from '@/lib/db';
import { ENTITIES } from '@/lib/entities';
import { parseField, loadRow } from '@/lib/engine';
import { updateVersioned, nextNumber, audit, need } from '@/lib/domain/common';
import { idem, state, str, guard } from '@/lib/form';

const ent = (k: string) => { const e = ENTITIES[k]; if (!e) throw new AppError('Unknown record type.', 'unknown'); return e; };
const base = (e: any, pid: string | null) => e.scoped ? `/p/${pid}/e/${e.key}` : `/o/${e.key}`;

export async function createEntityAction(key: string, pid: string | null, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const e = ent(key);
    const vals: Record<string, unknown> = {};
    for (const f of e.fields.filter(f => !f.hideForm && !f.ro)) vals[f.n] = parseField(f, fd);
    const r = await run({ perm: `${e.module}:create`, idem: idem(fd) }, async ({ ctx, q }) => {
      if (e.scoped) { const p = await one<any>(q, 'select id from projects where id = $1', [pid]); need(p, 'Project not found.'); }
      const cols: string[] = ['org_id', 'created_by']; const params: unknown[] = [ctx.orgId, ctx.userId];
      if (e.scoped) { cols.push('project_id'); params.push(pid); }
      if (e.number) { cols.push(e.number.field); params.push(await nextNumber(q, ctx, e.scoped ? pid! : '00000000-0000-0000-0000-000000000000', e.number.kind, e.number.prefix)); }
      for (const [k, v] of Object.entries(vals)) { cols.push(k); params.push(v); }
      const row = (await one<any>(q, `insert into ${e.table}(${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, params))!;
      await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `${e.key}.create`, entity: e.table, entityId: row.id });
      return row.id as string;
    });
    return state(r, { message: `${e.singular} created.`, redirect: id => `${base(e, pid)}/${id}` });
  });
}

export async function updateEntityAction(key: string, pid: string | null, id: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const e = ent(key);
    const vals: Record<string, unknown> = {};
    for (const f of e.fields.filter(f => !f.hideForm && !f.ro)) vals[f.n] = parseField(f, fd);
    const version = Number(str(fd, '_version'));
    const r = await run({ perm: `${e.module}:edit`, idem: idem(fd) }, async ({ ctx, q }) => {
      const row = await loadRow(q, e, id); need(row, 'This record no longer exists or you cannot access it.');
      need(!e.editWhen || e.editWhen(row), 'This record can no longer be edited in its current status.');
      await updateVersioned(q, e.table, id, version, vals);
      await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `${e.key}.update`, entity: e.table, entityId: id, detail: { fields: Object.keys(vals) } });
    });
    return state(r, { message: 'Changes saved.' });
  });
}

export async function entityActionRun(key: string, pid: string | null, id: string, act: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const e = ent(key); const a = e.actions?.find(x => x.key === act);
    if (!a) return { error: 'That action is not available.' };
    const reason = str(fd, 'reason') || null;
    const r = await run({ perm: a.perm }, async ({ ctx, q }) => {
      const row = await one<any>(q, `select * from ${e.table} where id = $1 for update`, [id]); need(row, 'This record no longer exists or you cannot access it.');
      need(a.when(row), 'This action is no longer available — the record has changed. Reload to see its current status.', 'stale');
      if (a.reason) { need((reason ?? '').trim().length >= 3, `${a.reason} is required.`, 'reason'); }
      await a.run(q, ctx, row, reason, fd);
    });
    revalidatePath(base(e, pid)); 
    return state(r, { message: `${a.label} — done.` });
  });
}

export async function bulkDeleteAction(key: string, pid: string | null, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const e = ent(key); const ids = fd.getAll('ids').map(String).filter(i => /^[0-9a-f-]{36}$/.test(i));
    if (!ids.length) return { error: 'Select at least one record first.' };
    const r = await run({ perm: `${e.module}:edit` }, async ({ ctx, q }) => {
      let n = 0;
      for (const id of ids) {
        const row = await loadRow(q, e, id);
        if (row && e.deleteWhen?.(row)) { await q.query(`delete from ${e.table} where id = $1`, [id]); n++; await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `${e.key}.delete`, entity: e.table, entityId: id }); }
      }
      need(n > 0, 'None of the selected records can be deleted (only drafts can).');
      return n;
    });
    return state(r, { message: `Deleted ${r.ok ? r.data : 0} draft record(s).` });
  });
}

export async function saveViewAction(scope: string, _: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, 'name'); if (name.length < 2) return { error: 'Give the view a name.' };
  const r = await run({ write: false }, async ({ ctx, q }) => {
    await q.query(`insert into saved_views(org_id, user_id, scope, name, query) values ($1,$2,$3,$4,$5) on conflict (user_id, scope, name) do update set query = excluded.query`, [ctx.orgId, ctx.userId, scope, name, str(fd, 'query')]);
  });
  return state(r, { message: 'View saved.' });
}
export async function deleteViewAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await run({ write: false }, async ({ q }) => { await q.query('delete from saved_views where id = $1', [str(fd, 'id')]); });
  return state(r, { message: 'View removed.' });
}
