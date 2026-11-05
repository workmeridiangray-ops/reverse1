import { type Ctx, type Q, AppError, many, one, audit, notify, need, needReason, nextNumber, projectMembers } from './common';

export async function decideInspection(q: Q, ctx: Ctx, id: string, outcome: 'passed' | 'failed' | 'waived', note: string) {
  const i = await one<any>(q, 'select * from inspections where id = $1 for update', [id]);
  need(i?.status === 'requested', 'This inspection has already been decided.');
  needReason(note, 'an outcome note');
  if (outcome === 'waived') need(['owner', 'manager'].includes(ctx.role), 'Only a manager can waive an inspection, and a reason is recorded.', 'authority');
  await q.query(`update inspections set status = $2, outcome_note = $3, waiver_reason = $4, decided_by = $5 where id = $1`, [id, outcome, note, outcome === 'waived' ? note : null, ctx.userId]);
  if (outcome === 'failed') {
    const number = await nextNumber(q, ctx, i.project_id, 'ncr', 'NCR');
    await q.query(`insert into ncrs(org_id, project_id, number, inspection_id, description, created_by) values ($1,$2,$3,$4,$5,$6)`, [ctx.orgId, i.project_id, number, id, `Failed inspection ${i.number}: ${note}`, ctx.userId]);
  }
  // A recorded outcome is an observation, not a certificate.
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `inspection.${outcome}`, entity: 'inspections', entityId: id, detail: { hold_point: i.hold_point, note } });
}

export async function addAction(q: Q, ctx: Ctx, ncrId: string, action: string, ownerId: string | null, due: string | null) {
  const n = await one<any>(q, 'select * from ncrs where id = $1 for update', [ncrId]);
  need(n && n.status !== 'closed', 'This nonconformance is closed.'); needReason(action, 'the corrective action');
  await q.query(`insert into corrective_actions(org_id, project_id, ncr_id, action, owner_user_id, due_date, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [ctx.orgId, n.project_id, ncrId, action, ownerId, due, ctx.userId]);
  await q.query(`update ncrs set status = 'action_assigned' where id = $1 and status = 'open'`, [ncrId]);
  if (ownerId) await notify(q, ctx.orgId!, [ownerId], `Corrective action for ${n.number}`, action, `/p/${n.project_id}/ncrs/${ncrId}`);
}
export async function completeAction(q: Q, ctx: Ctx, actionId: string, evidenceFileId: string | null) {
  const a = await one<any>(q, 'select * from corrective_actions where id = $1 for update', [actionId]);
  need(a?.status === 'open', 'This action is not open.'); need(evidenceFileId, 'Attach evidence of the correction (photo or document).', 'evidence');
  await q.query(`update corrective_actions set status = 'done', evidence_file_id = $2 where id = $1`, [actionId, evidenceFileId]);
  await q.query(`update ncrs set status = 'action_done' where id = $1 and not exists (select 1 from corrective_actions where ncr_id = $1 and status = 'open')`, [a.ncr_id]);
}
export async function verifyAction(q: Q, ctx: Ctx, actionId: string) {
  const a = await one<any>(q, 'select * from corrective_actions where id = $1 for update', [actionId]);
  need(a?.status === 'done', 'Only a completed action can be verified.');
  need(a.owner_user_id !== ctx.userId && a.created_by !== ctx.userId || ['owner', 'manager'].includes(ctx.role), 'Verification must be done by someone other than the action owner.', 'segregation');
  await q.query(`update corrective_actions set status = 'verified', verified_by = $2 where id = $1`, [actionId, ctx.userId]);
  const open = await one<any>(q, `select count(*) n from corrective_actions where ncr_id = $1 and status <> 'verified'`, [a.ncr_id]);
  if (Number(open!.n) === 0) await q.query(`update ncrs set status = 'verified' where id = $1`, [a.ncr_id]);
}
export async function closeNcr(q: Q, ctx: Ctx, ncrId: string) {
  const n = await one<any>(q, 'select * from ncrs where id = $1 for update', [ncrId]);
  need(n?.status === 'verified', 'All corrective actions must be verified before the NCR can be closed.');
  await q.query(`update ncrs set status = 'closed' where id = $1`, [ncrId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'ncr.close', entity: 'ncrs', entityId: ncrId });
}
