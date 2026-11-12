'use server';
import type { FormState } from '@/components/ActionForm';
import { run } from '@/lib/session';
import { withTenant, one } from '@/lib/db';
import { state, str, guard } from '@/lib/form';
import { need, needReason } from '@/lib/domain/common';
import * as bill from '@/lib/domain/billing';

const P = { external: true } as const;
export async function portalVariation(id: string, approve: boolean, _: FormState, fd: FormData): Promise<FormState> {
  return state(await run({ ...P }, async ({ q }) => { await q.query('select portal_decide_variation($1,$2,$3)', [id, approve, str(fd, 'reason')]); }), { message: approve ? 'Variation approved.' : 'Variation rejected.' });
}
export async function portalRfi(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return state(await run({ ...P }, async ({ q }) => { await q.query('select portal_respond_rfi($1,$2)', [id, str(fd, 'answer')]); }), { message: 'Response sent.' });
}
/** Certification maths is the app's single implementation; the portal user's authority is checked first, then the write runs with system privileges as that user. */
export async function portalBill(id: string, approve: boolean, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => state(await run({ ...P }, async ({ ctx, q }) => {
    need(['client', 'consultant'].includes(ctx.role), 'Only the client or consultant can certify.');
    const b = await one<any>(q, 'select * from ra_bills where id=$1', [id]); need(b, 'Bill not found.');
    const cert: Record<string, string> = {};
    if (approve) for (const [k, v] of fd.entries()) if (k.startsWith('cert_')) cert[k.slice(5)] = String(v).trim() || '0';
    await withTenant({ ...ctx, role: 'system' }, async q2 => { if (approve) await bill.certifyBill(q2, ctx, id, cert, null, str(fd, 'reduce_reason')); else await bill.rejectBill(q2, ctx, id, str(fd, 'reason')); });
  }), { message: approve ? 'Bill certified.' : 'Bill rejected with your reason.' }));
}
