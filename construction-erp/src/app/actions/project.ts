'use server';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/ActionForm';
import { run, getSession } from '@/lib/session';
import { AppError, many, one, withSystem } from '@/lib/db';
import { idem, state, str, opt, money, qty, int, date, guard } from '@/lib/form';
import { audit, need, needReason, toNumeric, milli, nextNumber } from '@/lib/domain/common';
import * as con from '@/lib/domain/contracts';
import * as plan from '@/lib/domain/planning';
import * as bill from '@/lib/domain/billing';
import * as proc from '@/lib/domain/procurement';
import * as site from '@/lib/domain/site';
import * as ho from '@/lib/domain/handover';
import * as ident from '@/lib/identity';
import { enqueue } from '@/lib/jobs';
import { env } from '@/lib/env';
import { parseQty } from '@/lib/rules/money';

const ok = (r: any, message: string, redirect?: (d: any) => string | undefined): FormState => state(r, { message, redirect });

// ---- contract ----------------------------------------------------------------------------------
export async function createContractAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const v = { number: str(fd, 'number'), title: str(fd, 'title'), adv: int(fd, 'advance_bp', 0, 10000), rec: int(fd, 'advance_recovery_bp', 0, 10000), ret: int(fd, 'retention_bp', 0, 10000), sec: int(fd, 'security_deposit_bp', 0, 10000), days: int(fd, 'payment_days', 0, 365) };
    need(v.number && v.title, 'Contract number and title are required.'); need(v.rec <= 10000, 'Recovery cannot exceed 100%.');
    return ok(await run({ perm: 'contract:create', idem: idem(fd) }, async ({ ctx, q }) => {
      await q.query(`insert into contracts(org_id, project_id, number, title, advance_bp, advance_recovery_bp, retention_bp, security_deposit_bp, payment_days, start_date, end_date, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [ctx.orgId, pid, v.number, v.title, v.adv, v.rec, v.ret, v.sec, v.days, opt(fd, 'start_date'), opt(fd, 'end_date'), ctx.userId]);
    }), 'Contract drafted. Review the terms, then activate to snapshot the commercial basis.');
  });
}
export async function activateContractAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'contract:approve' }, ({ ctx, q }) => con.activateContract(q, ctx, id)), 'Contract activated. The BOQ, rates and billing terms are now snapshotted.');
}
export async function recordAdvanceAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'contract:approve', idem: idem(fd) }, ({ ctx, q }) => con.recordAdvance(q, ctx, id, money(fd, 'amount'))), 'Advance recorded.'));
}
export async function releaseRetentionAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'contract:approve', idem: idem(fd) }, ({ ctx, q }) => con.releaseRetention(q, ctx, id, money(fd, 'amount'), str(fd, 'reason'))), 'Retention released.'));
}

// ---- schedule ----------------------------------------------------------------------------------
export async function addDependencyAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'planning:edit', idem: idem(fd) }, ({ ctx, q }) => plan.addDependency(q, ctx, pid, str(fd, 'pred_id'), str(fd, 'succ_id'), int(fd, 'lag_days', -365, 365))), 'Link added.'));
}
export async function removeDependencyAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'planning:edit' }, async ({ q }) => { await q.query('delete from activity_deps where id = $1', [id]); }), 'Link removed.');
}
export async function rescheduleAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'planning:edit', idem: idem(fd) }, ({ ctx, q }) => plan.reschedule(q, ctx, id, date(fd, 'start'), date(fd, 'finish'), str(fd, 'reason'))), 'Dates updated. The baseline is unchanged.'));
}
export async function approveBaselineAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'planning:approve' }, ({ ctx, q }) => plan.approveBaseline(q, ctx, pid, str(fd, 'note'))), 'Baseline approved and stored as a new version.');
}

// ---- billing -----------------------------------------------------------------------------------
export async function createBillAction(contractId: string, pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'billing:create', idem: idem(fd) }, ({ ctx, q }) => bill.createBill(q, ctx, contractId, date(fd, 'period_to'))), 'Bill drafted from verified measurements.', (b: any) => `/p/${pid}/billing/${b.id}`));
}
export async function submitBillAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'billing:edit' }, ({ ctx, q }) => bill.submitBill(q, ctx, id)), 'Bill submitted for certification.');
}
export async function certifyBillAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const cert: Record<string, string> = {}; for (const [k, v] of fd.entries()) if (k.startsWith('cert_')) cert[k.slice(5)] = String(v).trim() === '' ? '0' : String(v);
    for (const v of Object.values(cert)) try { parseQty(v); } catch { throw new AppError('Certified quantities must be numbers with up to 3 decimals.'); }
    return ok(await run({ perm: 'billing:approve', idem: idem(fd) }, ({ ctx, q }) => bill.certifyBill(q, ctx, id, cert, str(fd, 'ref'), str(fd, 'reduce_reason'))), 'Bill certified. Recoveries and retention were calculated on cumulative gross value.');
  });
}
export async function rejectBillAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'billing:approve' }, ({ ctx, q }) => bill.rejectBill(q, ctx, id, str(fd, 'reason'))), 'Bill rejected. Its measurements are available for the next bill.');
}
export async function invoiceBillAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'billing:edit' }, ({ ctx, q }) => bill.invoiceBill(q, ctx, id)), 'Invoice raised.');
}
export async function receiptAction(invoiceId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'billing:edit', idem: idem(fd) }, ({ ctx, q }) => bill.recordReceipt(q, ctx, { invoiceId, amount: money(fd, 'amount'), receivedOn: date(fd, 'received_on'), method: str(fd, 'method') || 'bank', reference: str(fd, 'reference') })), 'Receipt recorded.'));
}
export async function disputeAction(invoiceId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'billing:edit', idem: idem(fd) }, ({ ctx, q }) => bill.raiseDispute(q, ctx, invoiceId, money(fd, 'amount'), str(fd, 'reason'))), 'Dispute recorded against the outstanding balance.'));
}
export async function resolveDisputeAction(id: string, outcome: 'resolved' | 'written_off', _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: outcome === 'written_off' ? 'billing:approve' : 'billing:edit' }, ({ ctx, q }) => bill.resolveDispute(q, ctx, id, outcome, str(fd, 'reason'))), 'Dispute updated.');
}

// ---- stores ------------------------------------------------------------------------------------
export async function issueStockAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'stores:create', idem: idem(fd) }, ({ ctx, q }) => proc.issueStock(q, ctx, { projectId: pid, siteId: str(fd, 'site_id'), itemCode: str(fd, 'item_code'), qty: qty(fd, 'qty'), activityId: opt(fd, 'activity_id'), note: opt(fd, 'note') ?? undefined })), 'Material issued.'));
}
export async function returnStoreAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'stores:create', idem: idem(fd) }, ({ ctx, q }) => proc.returnToStore(q, ctx, { projectId: pid, siteId: str(fd, 'site_id'), itemCode: str(fd, 'item_code'), qty: qty(fd, 'qty'), note: opt(fd, 'note') ?? undefined })), 'Returned to store.'));
}
export async function returnSupplierAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'stores:create', idem: idem(fd) }, ({ ctx, q }) => proc.returnToSupplier(q, ctx, { projectId: pid, siteId: str(fd, 'site_id'), itemCode: str(fd, 'item_code'), qty: qty(fd, 'qty'), note: str(fd, 'note') })), 'Rejected material sent back to the supplier.'));
}
export async function dispatchTransferAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'stores:create', idem: idem(fd) }, ({ ctx, q }) => proc.dispatchTransfer(q, ctx, { projectId: pid, fromSiteId: str(fd, 'from_site_id'), toSiteId: str(fd, 'to_site_id'), lines: [{ itemCode: str(fd, 'item_code'), qty: qty(fd, 'qty') }] })), 'Transfer dispatched. The destination site must confirm receipt.'));
}
export async function receiveTransferAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'stores:create' }, ({ ctx, q }) => proc.receiveTransfer(q, ctx, id)), 'Transfer received into the destination store.');
}
export async function stockCountAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'stores:edit', idem: idem(fd) }, async ({ ctx, q }) => {
    const siteId = str(fd, 'site_id'); const lines: { code: string; unit: string; counted: string }[] = [];
    for (const [k, v] of fd.entries()) if (k.startsWith('count_') && String(v).trim() !== '') { try { parseQty(String(v)); } catch { throw new AppError('Counted quantities must be numbers.'); } lines.push({ code: k.slice(6), unit: str(fd, 'unit_' + k.slice(6)), counted: String(v) }); }
    need(lines.length > 0, 'Enter at least one counted quantity.');
    const c = (await one<any>(q, `insert into stock_counts(org_id, project_id, site_id, created_by) values ($1,$2,$3,$4) returning id`, [ctx.orgId, pid, siteId, ctx.userId]))!;
    for (const l of lines) { const sys = await proc.stockOnHand(q, pid, siteId, l.code); await q.query(`insert into stock_count_lines(org_id, project_id, count_id, item_code, unit, system_qty, counted_qty, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [ctx.orgId, pid, c.id, l.code, l.unit, toNumeric(sys), toNumeric(parseQty(l.counted)), ctx.userId]); }
    await proc.applyStockCount(q, ctx, c.id);
  }), 'Count applied. Differences were posted as adjustments.'));
}

// ---- daily reports -----------------------------------------------------------------------------
function readReport(pid: string, fd: FormData): site.ReportInput {
  const rows = (prefix: string, fields: string[]) => { const n = Number(str(fd, `${prefix}_n`)) || 0; return Array.from({ length: Math.min(n, 60) }, (_, i) => Object.fromEntries(fields.map(f => [f, String(fd.get(`${prefix}_${f}_${i}`) ?? '').trim()]))); };
  const num = (s: string, label: string, max: number) => { const n = Number(s || 0); if (!Number.isFinite(n) || n < 0 || n > max) throw new AppError(`${label} must be between 0 and ${max}.`); return n; };
  return {
    projectId: pid, siteId: str(fd, 'site_id'), date: date(fd, 'report_date'), weather: str(fd, 'weather'), notes: str(fd, 'notes'), id: opt(fd, 'id') ?? undefined, version: opt(fd, 'version') ? Number(str(fd, 'version')) : undefined,
    labour: rows('lab', ['trade', 'headcount', 'hours']).filter(r => r.trade).map(r => ({ trade: r.trade, headcount: Math.round(num(r.headcount, 'Headcount', 5000)), hours: num(r.hours, 'Hours', 24) })),
    equipment: rows('eq', ['name', 'hours', 'idle']).filter(r => r.name).map(r => ({ name: r.name, hours: num(r.hours, 'Equipment hours', 24), idle: num(r.idle, 'Idle hours', 24) })),
    quantities: rows('qt', ['activity', 'claimed']).filter(r => r.activity && r.claimed !== '').map(r => ({ activityId: r.activity, claimed: r.claimed })),
    issues: rows('is', ['text', 'severity']).filter(r => r.text).map(r => ({ text: r.text, severity: (['low', 'medium', 'high'].includes(r.severity) ? r.severity : 'low') as any })),
    photos: fd.getAll('photo_id').map(String).filter(Boolean).map(id => ({ fileId: id })),
  };
}
export async function saveReportAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const input = readReport(pid, fd); const submit = str(fd, 'intent') === 'submit';
    const r = await run({ perm: 'site:create', idem: idem(fd) }, async ({ ctx, q }) => {
      const rep = await site.saveReport(q, ctx, input);
      if (submit) await site.submitReport(q, ctx, rep.id);
      return rep.id as string;
    });
    return state(r, { message: submit ? 'Report submitted for review.' : 'Draft saved.', redirect: id => `/p/${pid}/reports/${id}` });
  });
}
export async function verifyReportAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const v: Record<string, { qty: string; reason?: string }> = {};
    for (const [k, val] of fd.entries()) if (k.startsWith('vq_')) { const lid = k.slice(3); try { parseQty(String(val)); } catch { throw new AppError('Verified quantities must be numbers (use 0 if nothing was verified).'); } v[lid] = { qty: String(val), reason: str(fd, 'vr_' + lid) }; }
    return ok(await run({ perm: 'site:approve', idem: idem(fd) }, ({ ctx, q }) => site.verifyReport(q, ctx, id, v)), 'Report verified. Physical progress updated from verified quantities.');
  });
}
export async function requestCorrectionAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'site:approve' }, ({ ctx, q }) => site.requestCorrection(q, ctx, id, str(fd, 'reason'))), 'Sent back to the supervisor for correction.');
}

// ---- team & authority ---------------------------------------------------------------------------
export async function addProjectMemberAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const auth = fd.getAll('authorities').map(String).filter(a => ['po:approve', 'bill:certify', 'bill:submit', 'variation:approve', 'variation:submit'].includes(a));
    return ok(await run({ perm: 'team:edit', idem: idem(fd) }, async ({ ctx, q }) => {
      const uid = str(fd, 'user_id'); const m = await one<any>(q, `select role from memberships where user_id = $1 and org_id = $2 and status = 'active'`, [uid, ctx.orgId]); need(m, 'That person is not in this workspace.');
      await q.query(`update project_members set effective_to = current_date - 1 where project_id = $1 and user_id = $2 and effective_to is null`, [pid, uid]);   // keep history, re-assign with new dates
      await q.query(`insert into project_members(org_id, project_id, user_id, project_role, approval_limit_paise, authorities, effective_from, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [ctx.orgId, pid, uid, m.role, str(fd, 'limit') ? money(fd, 'limit').toString() : '0', auth, opt(fd, 'effective_from') ?? new Date().toISOString().slice(0, 10), ctx.userId]);
      await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'project.member_set', entity: 'project_members', detail: { user: uid, authorities: auth } });
    }), 'Assignment saved.');
  });
}
export async function endProjectMemberAction(id: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'team:edit' }, async ({ ctx, q }) => { await q.query(`update project_members set effective_to = current_date where id = $1`, [id]); await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'project.member_end', entity: 'project_members', entityId: id }); }), 'Access ended today.');
}
export async function inviteExternalAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'team:create', idem: idem(fd) }, async ({ ctx, q, s }) => {
    const role = str(fd, 'role'); need(['client', 'consultant', 'contractor'].includes(role), 'Choose client, consultant or contractor.');
    const party = opt(fd, 'party_id'); if (role === 'contractor') need(party, 'Choose the subcontractor company this person belongs to.');
    await ident.createInvitation(q, { orgId: ctx.orgId!, email: str(fd, 'email'), role, invitedBy: ctx.userId, projectId: pid, partyId: party, appUrl: env.appUrl, orgName: s.org!.name });
  }), 'Invitation sent. They will see only this project and only what you approve for them.'));
}
export async function updateProjectAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'project:edit', idem: idem(fd) }, async ({ ctx, q }) => {
    await q.query(`update projects set name = $2, location = $3, start_date = $4, end_date = $5, dlp_months = $6, branch_id = $7 where id = $1`, [pid, str(fd, 'name'), opt(fd, 'location'), opt(fd, 'start_date'), opt(fd, 'end_date'), int(fd, 'dlp_months', 0, 120), opt(fd, 'branch_id')]);
    await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'project.update', entity: 'projects', entityId: pid });
  }), 'Project details saved.'));
}

// ---- handover & closure --------------------------------------------------------------------------
export async function startHandoverAction(pid: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'handover:approve' }, ({ ctx, q }) => ho.startHandover(q, ctx, pid)), 'Handover started. The completion checklist has been created.');
}
export async function toggleChecklistAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'handover:edit' }, async ({ ctx, q }) => {
    const done = str(fd, 'done') === '1'; if (done) needReason(str(fd, 'evidence'), 'the evidence (document or note)');
    await q.query('update completion_checklist set done = $2, evidence = $3, done_by = $4 where id = $1', [id, done, done ? str(fd, 'evidence') : null, done ? ctx.userId : null]);
  }), 'Checklist updated.');
}
export async function prepareFinalAccountAction(pid: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'handover:edit' }, ({ ctx, q }) => ho.prepareFinalAccount(q, ctx, pid)), 'Final account recalculated from current records.');
}
export async function agreeFinalAccountAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'handover:approve' }, ({ ctx, q }) => ho.agreeFinalAccount(q, ctx, pid, str(fd, 'reason'))), 'Final account agreed.');
}
export async function startDefectPeriodAction(pid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'handover:approve' }, ({ ctx, q }) => ho.startDefectPeriod(q, ctx, pid, date(fd, 'completion_date'))), 'Defect liability period started.'));
}
export async function closeProjectAction(pid: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'handover:approve' }, ({ ctx, q }) => ho.closeProject(q, ctx, pid)), 'Project closed. Records are now read-only; download the export package for your archive.');
}
export async function requestExportAction(pid: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'reports:export', write: false }, async ({ ctx, q }) => {
    await enqueue(q, 'project.export', { projectId: pid, requestedBy: ctx.userId }, { orgId: ctx.orgId, dedupeKey: `export:${pid}:${Math.floor(Date.now() / 60000)}` });
    await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: 'export.requested', entity: 'projects', entityId: pid });
  }), 'Export queued. You will be notified when the package is ready (usually within a minute).');
}
