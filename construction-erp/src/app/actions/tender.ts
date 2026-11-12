'use server';
import type { FormState } from '@/components/ActionForm';
import { run } from '@/lib/session';
import { state, str, int, idem, guard } from '@/lib/form';
import * as est from '@/lib/domain/estimating';
import { parseBoqCsv } from '@/lib/rules/boq';
import { AppError } from '@/lib/db';

export async function newRevisionAction(oppId: string, _: FormState, fd: FormData): Promise<FormState> {
  return state(await run({ perm: 'tender:create' }, ({ ctx, q }) => est.newRevision(q, ctx, oppId, str(fd, 'copy') || undefined)), { message: 'Revision created.' });
}
export async function importCsvAction(revId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const f = fd.get('file'); let text = str(fd, 'text');
    if (f instanceof File && f.size > 0) { if (f.size > 2_000_000) throw new AppError('The file is larger than 2 MB.'); text = await f.text(); }
    if (!text) throw new AppError('Choose a CSV file or paste its contents.');
    const preview = str(fd, 'intent') === 'preview';
    if (preview) { const r = parseBoqCsv(text); return r.errors.length ? { error: `${r.errors.length} row(s) have problems — nothing imported. ` + r.errors.slice(0, 8).map(e => `Row ${e.row}: ${e.message}`).join(' · ') } : { ok: true, message: `Preview OK: ${r.rows.length} rows are valid. Press "Import" to save them.` }; }
    const r = await run({ perm: 'tender:edit', idem: idem(fd) }, ({ ctx, q }) => est.importEstimateCsv(q, ctx, revId, text));
    if (!r.ok) return { error: r.error };
    if (r.data.errors.length) return { error: r.data.errors.slice(0, 8).map(e => `Row ${e.row}: ${e.message}`).join(' · ') };
    return { ok: true, message: `Imported ${r.data.imported} rows.` };
  });
}
export async function buildUpAction(itemId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ perm: 'tender:edit' }, ({ ctx, q }) => est.buildUpRate(q, ctx, itemId, str(fd, 'mat'), str(fd, 'lab'), str(fd, 'eqp'))), { message: 'Rate recalculated.' }));
}
export async function approveRevisionAction(revId: string, _: FormState, __: FormData): Promise<FormState> {
  return state(await run({ perm: 'tender:approve' }, ({ ctx, q }) => est.approveRevision(q, ctx, revId)), { message: 'Revision approved as the bid basis.' });
}
export async function awardAction(oppId: string, revId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ perm: 'tender:approve', idem: idem(fd) }, ({ ctx, q, s }) => est.awardOpportunity(q, ctx, { oppId, revisionId: revId, code: str(fd, 'code'), name: str(fd, 'name'), contingencyBp: int(fd, 'contingency_bp', 0, 5000), limits: { projects: s.sub?.limits?.projects ?? 1e9 } })),
    { message: 'Awarded. Project, BOQ and baseline budget created.', redirect: (r: any) => `/p/${r.project.id}` }));
}
