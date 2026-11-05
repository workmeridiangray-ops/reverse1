import { type Ctx, type Q, AppError, many, one, audit, need, needReason, nextNumber, milli, toNumeric } from './common';
import { parseBoqCsv, analyseRate, boqTotal } from '../rules/boq';
import { lineAmount, sum, parseMoney } from '../rules/money';

export async function importEstimateCsv(q: Q, ctx: Ctx, revisionId: string, text: string) {
  const rev = await one<any>(q, 'select * from estimate_revisions where id = $1', [revisionId]);
  need(rev, 'Estimate revision not found.');
  need(rev.status === 'draft', 'Only a draft revision can be changed. Create a new revision instead.');
  const { rows, errors } = parseBoqCsv(text);
  if (errors.length) return { imported: 0, errors };
  for (const r of rows) {
    await q.query(
      `insert into estimate_items(org_id, revision_id, code, description, unit, qty, qty_source, rate_paise, rate_source, created_by)
       values ($1,$2,$3,$4,$5,$6,'import',$7,'import',$8)
       on conflict (revision_id, code) do update set description = excluded.description, unit = excluded.unit, qty = excluded.qty, rate_paise = excluded.rate_paise, qty_source='import', rate_source='import'`,
      [ctx.orgId, revisionId, r.code, r.description, r.unit, toNumeric(r.qty), r.ratePaise.toString(), ctx.userId]);
  }
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'estimate.import', entity: 'estimate_revisions', entityId: revisionId, detail: { rows: rows.length } });
  return { imported: rows.length, errors: [] };
}

/** Rate analysis: derive rate from material/labour/equipment build-up + overhead; sources retained. */
export async function buildUpRate(q: Q, ctx: Ctx, itemId: string, mat: string, lab: string, eqp: string) {
  const it = await one<any>(q, `select i.*, r.overhead_bp, r.status from estimate_items i join estimate_revisions r on r.id = i.revision_id where i.id = $1`, [itemId]);
  need(it, 'Item not found.'); need(it.status === 'draft', 'Only draft revisions can be edited.');
  const m = parseMoney(mat), l = parseMoney(lab), e = parseMoney(eqp);
  const rate = analyseRate(m, l, e, it.overhead_bp);
  await q.query(`update estimate_items set mat_paise=$2, lab_paise=$3, eqp_paise=$4, rate_paise=$5, rate_source='rate analysis' where id=$1`, [itemId, m.toString(), l.toString(), e.toString(), rate.toString()]);
  return rate;
}

export async function newRevision(q: Q, ctx: Ctx, oppId: string, copyFrom?: string) {
  const last = await one<any>(q, 'select coalesce(max(rev_no),0) n from estimate_revisions where opportunity_id = $1', [oppId]);
  const rev = (await one<any>(q, `insert into estimate_revisions(org_id, opportunity_id, rev_no, created_by) values ($1,$2,$3,$4) returning *`, [ctx.orgId, oppId, Number(last.n) + 1, ctx.userId]))!;
  if (copyFrom) await q.query(`insert into estimate_items(org_id, revision_id, code, description, unit, qty, qty_source, rate_paise, rate_source, mat_paise, lab_paise, eqp_paise, created_by)
      select org_id, $1, code, description, unit, qty, qty_source, rate_paise, rate_source, mat_paise, lab_paise, eqp_paise, $3 from estimate_items where revision_id = $2`, [rev.id, copyFrom, ctx.userId]);
  return rev;
}

export async function approveRevision(q: Q, ctx: Ctx, revId: string) {
  const rev = await one<any>(q, 'select * from estimate_revisions where id = $1 for update', [revId]);
  need(rev, 'Revision not found.'); need(['draft', 'submitted'].includes(rev.status), 'This revision is already approved or superseded.');
  const n = await one<any>(q, 'select count(*) n from estimate_items where revision_id = $1', [revId]);
  need(Number(n.n) > 0, 'Add or import BOQ items before approving this revision.');
  await q.query(`update estimate_revisions set status = 'superseded' where opportunity_id = $1 and status = 'approved'`, [rev.opportunity_id]);
  await q.query(`update estimate_revisions set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [revId, ctx.userId]);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'estimate.approve', entity: 'estimate_revisions', entityId: revId });
}

export async function estimateSummary(q: Q, revId: string) {
  const items = await many<any>(q, 'select * from estimate_items where revision_id = $1 order by code', [revId]);
  const tender = boqTotal(items.map(i => ({ qtyMilli: milli(i.qty), ratePaise: BigInt(i.rate_paise) })));
  const direct = sum(items.map(i => lineAmount(milli(i.qty), BigInt(i.mat_paise) + BigInt(i.lab_paise) + BigInt(i.eqp_paise))));
  return { items, tender, direct };
}

/** Award: approved revision -> project, BOQ, baseline budget (cost) distinct from tender price. */
export async function awardOpportunity(q: Q, ctx: Ctx, p: { oppId: string; revisionId: string; code: string; name: string; branchId?: string | null; contingencyBp: number; limits: { projects: number } }) {
  const opp = await one<any>(q, 'select * from opportunities where id = $1 for update', [p.oppId]);
  need(opp, 'Opportunity not found.'); need(!opp.project_id, 'This opportunity has already been awarded.');
  const rev = await one<any>(q, 'select * from estimate_revisions where id = $1 and opportunity_id = $2', [p.revisionId, p.oppId]);
  need(rev?.status === 'approved', 'Only an approved estimate revision can be awarded.');
  const usage = await one<any>(q, 'select org_usage($1) u', [ctx.orgId]);
  if (usage!.u.projects + 1 > p.limits.projects) throw new AppError(`Your plan allows ${p.limits.projects} active projects. Upgrade to award this one.`, 'plan_limit');
  const proj = (await one<any>(q, `insert into projects(org_id, code, name, client_party_id, branch_id, owner_user_id, status, created_by) values ($1,$2,$3,$4,$5,$6,'planning',$6) returning *`,
    [ctx.orgId, p.code.trim(), p.name.trim(), opp.client_party_id, p.branchId ?? null, ctx.userId]))!;
  await q.query(`insert into project_members(org_id, project_id, user_id, project_role, authorities, approval_limit_paise, created_by) values ($1,$2,$3,'owner',$4,$5,$3)`,
    [ctx.orgId, proj.id, ctx.userId, ['po:approve', 'bill:submit', 'variation:submit'], '9223372036854775807']);
  const items = await many<any>(q, 'select * from estimate_items where revision_id = $1', [p.revisionId]);
  for (const i of items) {
    const direct = BigInt(i.mat_paise) + BigInt(i.lab_paise) + BigInt(i.eqp_paise);
    await q.query(`insert into boq_items(org_id, project_id, code, description, unit, qty, rate_paise, budget_rate_paise, source, est_item_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'tender',$9,$10)`, [ctx.orgId, proj.id, i.code, i.description, i.unit, i.qty, i.rate_paise, (direct > 0n ? direct : BigInt(i.rate_paise)).toString(), i.id, ctx.userId]);
  }
  await q.query(`update opportunities set status = 'awarded', project_id = $2 where id = $1`, [p.oppId, proj.id]);
  const tot = await baselineBudget(q, ctx, proj.id, p.contingencyBp);
  await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'tender.award', entity: 'projects', entityId: proj.id, detail: { revision: rev.rev_no, items: items.length } });
  return { project: proj, ...tot };
}

/** Baseline budget: tender price, approved cost budget, and contingency are separate numbers. */
export async function baselineBudget(q: Q, ctx: Ctx, projectId: string, contingencyBp: number) {
  const items = await many<any>(q, 'select * from boq_items where project_id = $1 order by code', [projectId]);
  need(items.length > 0, 'There are no BOQ items to baseline.');
  const tender = sum(items.map(i => lineAmount(milli(i.qty), BigInt(i.rate_paise))));
  const budget = sum(items.map(i => lineAmount(milli(i.qty), BigInt(i.budget_rate_paise))));
  const contingency = (budget * BigInt(contingencyBp)) / 10000n;
  const no = Number((await one<any>(q, 'select coalesce(max(baseline_no),0)+1 n from budget_baselines where project_id = $1', [projectId]))!.n);
  await q.query(`insert into budget_baselines(org_id, project_id, baseline_no, tender_total_paise, budget_total_paise, contingency_paise, snapshot, approved_by, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [ctx.orgId, projectId, no, tender.toString(), budget.toString(), contingency.toString(),
     JSON.stringify(items.map(i => ({ code: i.code, qty: i.qty, rate: i.rate_paise, budget_rate: i.budget_rate_paise }))), ctx.userId]);
  return { tender, budget, contingency, baselineNo: no };
}
