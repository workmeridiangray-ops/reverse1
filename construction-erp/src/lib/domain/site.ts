import { type Ctx, type Q, AppError, many, one, audit, notify, need, needReason, milli, toNumeric, updateVersioned, projectMembers } from './common';
import { holdPointBlocks, progressBp } from '../rules/schedule';

export interface ReportInput {
  projectId: string; siteId: string; date: string; weather?: string; notes?: string; version?: number; id?: string;
  labour: { trade: string; headcount: number; hours: number }[];
  equipment: { name: string; hours: number; idle: number }[];
  quantities: { activityId: string; claimed: string }[];
  issues: { text: string; severity: 'low' | 'medium' | 'high' }[];
  photos: { fileId: string; caption?: string }[];
}

/** Save as draft (safe to call repeatedly). Uses the version so two supervisors cannot silently overwrite each other. */
export async function saveReport(q: Q, ctx: Ctx, r: ReportInput) {
  need(r.date <= new Date().toISOString().slice(0, 10), 'A report cannot be dated in the future.');
  let rep: any;
  if (r.id) {
    rep = await one<any>(q, 'select * from daily_reports where id = $1 for update', [r.id]); need(rep, 'Report not found.');
    need(['draft', 'correction_requested'].includes(rep.status), 'This report has been submitted and can no longer be edited.');
    rep = await updateVersioned(q, 'daily_reports', r.id, r.version ?? rep.version, { weather: r.weather ?? null, notes: r.notes ?? null });
  } else {
    const dup = await one<any>(q, 'select id from daily_reports where project_id = $1 and site_id = $2 and report_date = $3', [r.projectId, r.siteId, r.date]);
    need(!dup, 'A report for this site and date already exists. Open it from the list instead.', 'duplicate');
    rep = (await one<any>(q, `insert into daily_reports(org_id, project_id, site_id, report_date, weather, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [ctx.orgId, r.projectId, r.siteId, r.date, r.weather ?? null, r.notes ?? null, ctx.userId]))!;
  }
  for (const t of ['report_labour', 'report_equipment', 'report_issues', 'report_photos']) await q.query(`delete from ${t} where report_id = $1`, [rep.id]);
  await q.query('delete from report_quantities where report_id = $1 and verified_qty is null', [rep.id]);
  const base = [ctx.orgId, rep.project_id, rep.id];
  for (const l of r.labour.filter(l => l.trade.trim())) await q.query(`insert into report_labour(org_id, project_id, report_id, trade, headcount, hours, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [...base, l.trade.trim(), l.headcount, l.hours, ctx.userId]);
  for (const e of r.equipment.filter(e => e.name.trim())) await q.query(`insert into report_equipment(org_id, project_id, report_id, name, hours, idle_hours, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [...base, e.name.trim(), e.hours, e.idle, ctx.userId]);
  for (const i of r.issues.filter(i => i.text.trim())) await q.query(`insert into report_issues(org_id, project_id, report_id, text, severity, created_by) values ($1,$2,$3,$4,$5,$6)`, [...base, i.text.trim(), i.severity, ctx.userId]);
  for (const p of r.photos) await q.query(`insert into report_photos(org_id, project_id, report_id, file_id, caption, created_by) values ($1,$2,$3,$4,$5,$6)`, [...base, p.fileId, p.caption ?? null, ctx.userId]);
  const seen = new Set<string>();
  for (const x of r.quantities.filter(x => x.activityId && x.claimed !== '')) {
    need(!seen.has(x.activityId), 'Each activity can appear only once in a report.'); seen.add(x.activityId);
    await q.query(`insert into report_quantities(org_id, project_id, report_id, activity_id, claimed_qty, created_by) values ($1,$2,$3,$4,$5,$6)`, [...base, x.activityId, toNumeric(milli(x.claimed)), ctx.userId]);
  }
  return rep;
}

export async function submitReport(q: Q, ctx: Ctx, id: string) {
  const rep = await one<any>(q, 'select * from daily_reports where id = $1 for update', [id]);
  need(rep && ['draft', 'correction_requested'].includes(rep.status), 'This report cannot be submitted.');
  const hasContent = await one<any>(q, `select (select count(*) from report_quantities where report_id=$1) + (select count(*) from report_labour where report_id=$1) + (select count(*) from report_issues where report_id=$1) n`, [id]);
  need(Number(hasContent!.n) > 0, 'Add labour, work quantities or an issue before submitting.');
  await q.query(`update daily_reports set status = 'submitted', submitted_by = $2, correction_reason = null where id = $1`, [id, ctx.userId]);
  const reviewers = await projectMembers(q, rep.project_id, ['owner', 'manager', 'engineer']);
  await notify(q, ctx.orgId!, reviewers.map(r => r.user_id), 'Daily report awaiting review', rep.report_date, `/p/${rep.project_id}/daily_reports/${id}`);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'report.submit', entity: 'daily_reports', entityId: id });
}

export async function requestCorrection(q: Q, ctx: Ctx, id: string, reason: string) {
  const rep = await one<any>(q, 'select * from daily_reports where id = $1 for update', [id]);
  need(rep?.status === 'submitted', 'Only a submitted report can be sent back.');
  needReason(reason, 'a reason for the correction');
  await q.query(`update daily_reports set status = 'correction_requested', correction_reason = $2, supervisor_note = $2 where id = $1`, [id, reason]);
  if (rep.submitted_by) await notify(q, ctx.orgId!, [rep.submitted_by], 'Daily report needs correction', reason, `/p/${rep.project_id}/daily_reports/${id}`);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'report.correction_requested', entity: 'daily_reports', entityId: id, detail: { reason } });
}

/** Supervisor review: verified quantity may differ from claimed, but only with an explanation. Verified quantity drives physical progress. */
export async function verifyReport(q: Q, ctx: Ctx, id: string, verified: Record<string, { qty: string; reason?: string }>) {
  const rep = await one<any>(q, 'select * from daily_reports where id = $1 for update', [id]);
  need(rep?.status === 'submitted', 'This report is not awaiting review.');
  need(rep.submitted_by !== ctx.userId || ['owner', 'manager'].includes(ctx.role), 'Someone other than the author must verify a report.', 'segregation');
  const lines = await many<any>(q, 'select * from report_quantities where report_id = $1', [id]);
  for (const l of lines) {
    const v = verified[l.id]; need(v && v.qty !== '', 'Enter a verified quantity for every line (use 0 if nothing was verified).');
    const vq = milli(v.qty);
    if (vq !== milli(l.claimed_qty)) needReason(v.reason, 'an explanation where verified differs from claimed');
    const act = (await one<any>(q, 'select * from activities where id = $1 for update', [l.activity_id]))!;
    if (vq > 0n) {
      const insp = await many<any>(q, 'select hold_point, status from inspections where activity_id = $1', [l.activity_id]);
      if (holdPointBlocks(act.requires_hold_release, insp)) throw new AppError(`Activity ${act.code} is behind a hold point. The inspection must pass before work is verified.`, 'hold_point');
    }
    await q.query('update report_quantities set verified_qty = $2, correction_reason = $3, applied = true where id = $1', [l.id, toNumeric(vq), v.reason ?? null]);
    const done = milli(act.done_qty) + vq;
    const planned = milli(act.planned_qty);
    const complete = act.measure_rule !== 'milestone' && planned > 0n && done >= planned;
    await q.query(`update activities set done_qty = $2, status = $3 where id = $1`, [act.id, toNumeric(done), complete ? 'complete' : (done > 0n ? 'in_progress' : act.status)]);
  }
  await q.query(`update daily_reports set status = 'verified', verified_by = $2 where id = $1`, [id, ctx.userId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'report.verify', entity: 'daily_reports', entityId: id });
}

export async function reportDetail(q: Q, id: string) {
  const rep = await one<any>(q, `select r.*, w.name site_name from daily_reports r join wbs_nodes w on w.id = r.site_id where r.id = $1`, [id]);
  if (!rep) return null;
  const [labour, equipment, quantities, issues, photos] = await Promise.all([
    many<any>(q, 'select * from report_labour where report_id = $1 order by created_at', [id]),
    many<any>(q, 'select * from report_equipment where report_id = $1 order by created_at', [id]),
    many<any>(q, `select rq.*, a.code, a.name, a.planned_qty, a.done_qty from report_quantities rq join activities a on a.id = rq.activity_id where rq.report_id = $1 order by a.code`, [id]),
    many<any>(q, 'select * from report_issues where report_id = $1', [id]),
    many<any>(q, `select rp.*, f.name from report_photos rp join files f on f.id = rp.file_id where rp.report_id = $1`, [id]),
  ]);
  return { ...rep, labour, equipment, quantities, issues, photos };
}
export const activityProgress = (a: any) => progressBp(a.measure_rule, milli(a.done_qty), milli(a.planned_qty), a.status === 'complete');
