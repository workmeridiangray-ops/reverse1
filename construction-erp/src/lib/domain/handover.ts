import { type Ctx, type Q, AppError, many, one, audit, notify, need, needReason } from './common';
import { projectFinalAccount } from './billing';

export async function startHandover(q: Q, ctx: Ctx, projectId: string) {
  const p = await one<any>(q, 'select * from projects where id = $1 for update', [projectId]);
  need(p?.status === 'active', 'Only an active project can move to handover.');
  await q.query(`update projects set status = 'handover' where id = $1`, [projectId]);
  const has = await one<any>(q, 'select count(*) n from completion_checklist where project_id = $1', [projectId]);
  if (Number(has!.n) === 0) {
    for (const item of ['All snags verified and closed', 'As-built drawings submitted', 'O&M manuals and warranties filed', 'Statutory completion approvals obtained', 'Final measurements agreed', 'Site cleared and keys handed over'])
      await q.query(`insert into completion_checklist(org_id, project_id, item, created_by) values ($1,$2,$3,$4)`, [ctx.orgId, projectId, item, ctx.userId]);
  }
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'project.handover_started', entity: 'projects', entityId: projectId });
}

export async function snagFlow(q: Q, ctx: Ctx, id: string, step: 'rectify' | 'verify' | 'reopen' | 'close', note?: string) {
  const s = await one<any>(q, 'select * from snags where id = $1 for update', [id]); need(s, 'Snag not found.');
  if (step === 'rectify') { need(s.status === 'open', 'Only an open snag can be rectified.'); needReason(note, 'a rectification note'); await q.query(`update snags set status='rectified', rectification_note=$2 where id=$1`, [id, note]); }
  else if (step === 'verify') { need(s.status === 'rectified', 'The snag must be rectified before it is verified.'); need(s.created_by !== ctx.userId || ['owner', 'manager'].includes(ctx.role), 'Verification needs someone other than the person who raised the snag... or a manager.', 'segregation'); await q.query(`update snags set status='verified', verified_by=$2 where id=$1`, [id, ctx.userId]); }
  else if (step === 'reopen') { need(['rectified', 'verified'].includes(s.status), 'Only a rectified or verified snag can be reopened.'); needReason(note, 'a reason'); await q.query(`update snags set status='open', rectification_note=$2, verified_by=null where id=$1`, [id, note]); }
  else { need(s.status === 'verified', 'Only a verified snag can be closed.'); await q.query(`update snags set status='closed' where id=$1`, [id]); }
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `snag.${step}`, entity: 'snags', entityId: id, detail: { note } });
}

export async function completionStatus(q: Q, projectId: string) {
  const open = await one<any>(q, `select count(*) n from snags where project_id = $1 and status not in ('verified','closed')`, [projectId]);
  const list = await many<any>(q, 'select * from completion_checklist where project_id = $1 order by created_at', [projectId]);
  const undone = list.filter(i => !i.done).length;
  const fa = await one<any>(q, 'select * from final_accounts where project_id = $1', [projectId]);
  return { openSnags: Number(open!.n), checklistTotal: list.length, checklistOpen: undone, finalAccountAgreed: fa?.status === 'agreed', ready: Number(open!.n) === 0 && undone === 0 && fa?.status === 'agreed' };
}

export async function prepareFinalAccount(q: Q, ctx: Ctx, projectId: string) {
  const fa = await projectFinalAccount(q, projectId); need(fa, 'There is no contract on this project.');
  const summary = JSON.parse(JSON.stringify(fa, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  await q.query(`insert into final_accounts(org_id, project_id, summary, status, created_by) values ($1,$2,$3,'reviewed',$4) on conflict (project_id) do update set summary = excluded.summary, status = case when final_accounts.status = 'agreed' then 'agreed' else 'reviewed' end`, [ctx.orgId, projectId, JSON.stringify(summary), ctx.userId]);
  return fa;
}
export async function agreeFinalAccount(q: Q, ctx: Ctx, projectId: string, reason?: string) {
  const fa = await prepareFinalAccount(q, ctx, projectId);
  if (fa.blockers.length) { need(['owner', 'manager'].includes(ctx.role), `Outstanding items: ${fa.blockers.join('; ')}.`, 'blockers'); needReason(reason, 'a reason for agreeing with outstanding items'); }
  await q.query(`update final_accounts set status = 'agreed', agreed_by = $2, agreed_at = now() where project_id = $1`, [projectId, ctx.userId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'final_account.agree', entity: 'final_accounts', detail: { blockers: fa.blockers, reason } });
}

/** Practical completion -> defect period. Reminders are informational and do not settle contractual liability. */
export async function startDefectPeriod(q: Q, ctx: Ctx, projectId: string, completionDate: string) {
  const p = await one<any>(q, 'select * from projects where id = $1 for update', [projectId]); need(p?.status === 'handover', 'The project must be in handover.');
  const st = await completionStatus(q, projectId);
  need(st.openSnags === 0 && st.checklistOpen === 0, `${st.openSnags} snag(s) and ${st.checklistOpen} checklist item(s) are still open.`, 'incomplete');
  await q.query(`update projects set status = 'defect_period', handover_date = $2, dlp_end = ($2::date + ($3 || ' months')::interval)::date where id = $1`, [projectId, completionDate, String(p.dlp_months)]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'project.defect_period', entity: 'projects', entityId: projectId, detail: { completionDate } });
}

export async function closeProject(q: Q, ctx: Ctx, projectId: string) {
  const p = await one<any>(q, 'select * from projects where id = $1 for update', [projectId]);
  need(p && ['handover', 'defect_period'].includes(p.status), 'Only a project in handover or defect period can be closed.');
  const st = await completionStatus(q, projectId);
  need(st.ready, 'Close is blocked: every snag must be verified, the checklist complete, and the final account agreed.', 'incomplete');
  const rec = await one<any>(q, `select count(*) n from invoices where project_id = $1 and collected_paise + written_off_paise < amount_paise`, [projectId]);
  need(Number(rec!.n) === 0, 'Some invoices still have an outstanding balance. Collect or resolve them first.');
  await q.query(`update projects set status = 'closed', closed_at = now() where id = $1`, [projectId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'project.close', entity: 'projects', entityId: projectId });
}
