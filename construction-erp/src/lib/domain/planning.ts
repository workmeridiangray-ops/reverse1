import { type Ctx, type Q, AppError, many, one, audit, need, needReason } from './common';
import { findCycle, dependencyViolations, varianceDays } from '../rules/schedule';

export async function addDependency(q: Q, ctx: Ctx, projectId: string, predId: string, succId: string, lag: number) {
  need(predId !== succId, 'An activity cannot depend on itself.');
  const deps = await many<any>(q, 'select pred_id, succ_id, lag_days from activity_deps where project_id = $1', [projectId]);
  const cyc = findCycle([...deps.map(d => ({ pred: d.pred_id, succ: d.succ_id, lag: d.lag_days })), { pred: predId, succ: succId, lag }]);
  if (cyc.length) {
    const names = await many<any>(q, 'select code from activities where id = any($1)', [cyc]);
    throw new AppError(`That link would create a loop (${names.map(n => n.code).join(' → ')}).`, 'cycle');
  }
  await q.query(`insert into activity_deps(org_id, project_id, pred_id, succ_id, lag_days, created_by) values ($1,$2,$3,$4,$5,$6)`, [ctx.orgId, projectId, predId, succId, lag, ctx.userId]);
}

export async function scheduleCheck(q: Q, projectId: string) {
  const acts = await many<any>(q, 'select id, code, name, start_date::text s, finish_date::text f, base_finish::text bf, status, done_qty, planned_qty from activities where project_id = $1 order by start_date, code', [projectId]);
  const deps = await many<any>(q, 'select pred_id, succ_id, lag_days from activity_deps where project_id = $1', [projectId]);
  const violations = dependencyViolations(acts.map(a => ({ id: a.id, start: a.s, finish: a.f })), deps.map(d => ({ pred: d.pred_id, succ: d.succ_id, lag: d.lag_days })));
  return { acts: acts.map(a => ({ ...a, variance: varianceDays(a.bf, a.f) })), violations };
}

/** Manual reschedule of one activity; dates stay free but conflicts are reported. Baseline dates never change. */
export async function reschedule(q: Q, ctx: Ctx, activityId: string, start: string, finish: string, reason: string) {
  const a = await one<any>(q, 'select * from activities where id = $1 for update', [activityId]);
  need(a, 'Activity not found.'); need(finish >= start, 'Finish cannot be before start.');
  needReason(reason, 'a delay or change reason');
  await q.query('update activities set start_date = $2, finish_date = $3, delay_reason = $4 where id = $1', [activityId, start, finish, reason]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'schedule.reschedule', entity: 'activities', entityId: activityId, detail: { start, finish, reason } });
  return scheduleCheck(q, a.project_id);
}

/** Approve a new baseline: store a versioned snapshot; the previous snapshot remains. */
export async function approveBaseline(q: Q, ctx: Ctx, projectId: string, note: string) {
  const { acts, violations } = await scheduleCheck(q, projectId);
  need(acts.length > 0, 'There are no activities to baseline.');
  need(violations.length === 0, 'Resolve the dependency conflicts before approving a baseline.');
  const no = Number((await one<any>(q, 'select coalesce(max(baseline_no),0)+1 n from schedule_baselines where project_id = $1', [projectId]))!.n);
  await q.query(`insert into schedule_baselines(org_id, project_id, baseline_no, note, snapshot, approved_by, created_by) values ($1,$2,$3,$4,$5,$6,$6)`,
    [ctx.orgId, projectId, no, note || null, JSON.stringify(acts.map(a => ({ code: a.code, start: a.s, finish: a.f }))), ctx.userId]);
  await q.query(`update activities set base_start = coalesce(base_start, start_date), base_finish = coalesce(base_finish, finish_date) where project_id = $1`, [projectId]);
  if (no > 1) await q.query('update activities set base_start = start_date, base_finish = finish_date where project_id = $1', [projectId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'schedule.baseline', entity: 'schedule_baselines', detail: { baseline: no } });
  return no;
}

/** Material needs by activity: requested vs ordered vs received for the activity's material requests. */
export async function materialNeeds(q: Q, projectId: string) {
  return many<any>(q, `select a.code, a.name, a.start_date::text, l.item_code, l.unit, sum(l.qty) requested,
      coalesce((select sum(pl.qty) from po_lines pl where pl.mr_line_id = any(array_agg(l.id))), 0) ordered,
      coalesce((select sum(pl.received_qty - pl.rejected_qty) from po_lines pl where pl.mr_line_id = any(array_agg(l.id))), 0) received
    from material_requests m join mr_lines l on l.mr_id = m.id join activities a on a.id = m.activity_id
    where m.project_id = $1 and m.status <> 'rejected' group by a.code, a.name, a.start_date, l.item_code, l.unit order by a.start_date, a.code`, [projectId]);
}
