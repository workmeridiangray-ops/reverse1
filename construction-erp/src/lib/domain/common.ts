import type { Ctx, Q } from '../db';
import { AppError, many, one } from '../db';
import { parseQty } from '../rules/money';
import { audit, notify } from '../audit';
export { AppError, many, one, audit, notify };
export type { Ctx, Q };

/** Atomic, gap-tolerant sequence per scope (project or org): RFI-0007. Safe under concurrency. */
export async function nextNumber(q: Q, ctx: Ctx, scope: string, kind: string, prefix: string, width = 4): Promise<string> {
  const r = await one<{ n: number }>(q, `insert into doc_counters(org_id, scope, kind, n) values ($1,$2,$3,1)
     on conflict (org_id, scope, kind) do update set n = doc_counters.n + 1 returning n`, [ctx.orgId, scope, kind]);
  return `${prefix}-${String(r!.n).padStart(width, '0')}`;
}
export const ZERO_SCOPE = '00000000-0000-0000-0000-000000000000';
export const milli = (s: string | number) => parseQty(String(s));
export const toNumeric = (m: bigint) => { const neg = m < 0n; const a = neg ? -m : m; return `${neg ? '-' : ''}${a / 1000n}.${String(a % 1000n).padStart(3, '0')}`; };

export function need(cond: unknown, msg: string, code = 'rule'): asserts cond { if (!cond) throw new AppError(msg, code); }
export function needReason(r: string | null | undefined, what = 'a reason'): string {
  const t = (r ?? '').trim(); if (t.length < 3) throw new AppError(`Please give ${what} (at least 3 characters).`, 'reason'); return t;
}
/** Optimistic concurrency: update only if the row still has the version the user was looking at. */
export async function updateVersioned(q: Q, table: string, id: string, version: number, set: Record<string, unknown>) {
  const keys = Object.keys(set);
  const sql = `update ${table} set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and version = $2 returning *`;
  const r = await q.query(sql, [id, version, ...keys.map(k => set[k])]);
  if (r.rowCount === 0) {
    const ex = await q.query(`select 1 from ${table} where id = $1`, [id]);
    throw new AppError(ex.rowCount ? 'Someone else changed this record while you were editing. Reload to see their changes, then re-apply yours.' : 'This record no longer exists or you cannot access it.', ex.rowCount ? 'conflict' : 'missing', ex.rowCount ? 409 : 404);
  }
  return r.rows[0];
}
export async function projectMembers(q: Q, projectId: string, roles?: string[]) {
  return many<{ user_id: string }>(q, `select distinct pm.user_id from project_members pm join memberships m on m.user_id = pm.user_id and m.org_id = pm.org_id and m.status = 'active'
     where pm.project_id = $1 and pm.effective_to is null ${roles ? 'and m.role = any($2)' : ''}`, roles ? [projectId, roles] : [projectId]);
}
export async function approvalAuthority(q: Q, ctx: Ctx, projectId: string, authority: string, amountPaise: bigint) {
  if (['owner', 'manager'].includes(ctx.role)) return;
  const pm = await one<any>(q, `select * from project_members where project_id = $1 and user_id = $2 and effective_to is null and effective_from <= current_date`, [projectId, ctx.userId]);
  if (!pm || !pm.authorities.includes(authority)) throw new AppError(`You are not delegated the authority "${authority}" on this project.`, 'authority');
  if (BigInt(pm.approval_limit_paise) < amountPaise) throw new AppError('This amount is above your approval limit. Ask someone with higher authority.', 'authority');
}
