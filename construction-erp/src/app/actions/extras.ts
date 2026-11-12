'use server';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/ActionForm';
import { run } from '@/lib/session';
import { AppError, many, one } from '@/lib/db';
import { idem, state, str, opt, money, qty, int, date, guard } from '@/lib/form';
import { audit, need, needReason, nextNumber, toNumeric, milli, notify } from '@/lib/domain/common';
import * as proc from '@/lib/domain/procurement';
import * as sub from '@/lib/domain/subcontract';
import * as bill from '@/lib/domain/billing';
import * as qual from '@/lib/domain/quality';
import { parseMoney, parseQty } from '@/lib/rules/money';

const ok = (r: any, message: string): FormState => state(r, { message });

export async function addMrLine(mrId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const code = str(fd, 'item_code'), desc = str(fd, 'description'), unit = str(fd, 'unit'); const q_ = qty(fd, 'qty');
    need(code && desc && unit, 'Item code, description and unit are required.'); need(q_ > 0n, 'Quantity must be greater than zero.');
    return ok(await run({ perm: 'procurement:create', idem: idem(fd) }, async ({ ctx, q }) => {
      const mr = await one<any>(q, 'select * from material_requests where id = $1', [mrId]); need(mr && ['draft', 'rejected'].includes(mr.status), 'Lines can only be added to a draft request.');
      await q.query(`insert into mr_lines(org_id, project_id, mr_id, item_code, description, unit, qty, boq_item_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [ctx.orgId, mr.project_id, mrId, code.toUpperCase(), desc, unit, toNumeric(q_), opt(fd, 'boq_item_id'), ctx.userId]);
    }), 'Line added.');
  });
}
export async function removeMrLine(lineId: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'procurement:edit' }, async ({ q }) => { const l = await one<any>(q, 'select m.status from mr_lines l join material_requests m on m.id = l.mr_id where l.id = $1', [lineId]); need(l && ['draft', 'rejected'].includes(l.status), 'Only draft requests can change.'); await q.query('delete from mr_lines where id = $1', [lineId]); }), 'Line removed.');
}
export async function createRfqAction(mrId: string, _: FormState, __: FormData): Promise<FormState> {
  const r = await run({ perm: 'procurement:create' }, ({ ctx, q }) => proc.createRfq(q, ctx, mrId));
  revalidatePath('/', 'layout'); return state(r, { message: 'RFQ created. Add supplier quotes on the Procurement page.' , redirect: () => undefined });
}
export async function addQuoteAction(rfqId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const rates: Record<string, bigint> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('rate_')) { try { rates[k.slice(5)] = parseMoney(String(v)); } catch { throw new AppError('Every rate must be an amount with up to 2 decimals.'); } }
    return ok(await run({ perm: 'procurement:create', idem: idem(fd) }, ({ ctx, q }) => proc.addQuote(q, ctx, rfqId, str(fd, 'supplier_id'), rates, str(fd, 'lead_days') ? int(fd, 'lead_days', 0, 365) : null)), 'Quote recorded.');
  });
}
export async function awardQuoteAction(quoteId: string, _: FormState, fd: FormData): Promise<FormState> {
  const r = await run({ perm: 'procurement:create' }, ({ ctx, q }) => proc.poFromQuote(q, ctx, quoteId, opt(fd, 'delivery_date')));
  revalidatePath('/', 'layout'); return state(r, { message: 'Purchase order created (draft). Open it to approve.' });
}
export async function receiveGoodsAction(poId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const lines: proc.GrnLineIn[] = [];
    for (const key of [...fd.keys()].filter(k => k.startsWith('rec_'))) {
      const id = key.slice(4); const received = String(fd.get(key) ?? '').trim(); if (!received || received === '0') continue;
      const rec = parseQty(received); const accRaw = String(fd.get('acc_' + id) ?? '').trim(); const acc = accRaw === '' ? rec : parseQty(accRaw);
      lines.push({ poLineId: id, received: rec, accepted: acc, rejected: rec - acc, reason: str(fd, 'reason_' + id), expectation: (str(fd, 'exp_' + id) || 'none') as any });
    }
    return ok(await run({ perm: 'stores:create', idem: idem(fd) }, ({ ctx, q }) => proc.receiveGoods(q, ctx, { poId, siteId: str(fd, 'site_id'), receivedOn: date(fd, 'received_on'), notes: opt(fd, 'notes') ?? undefined, lines })), 'Goods receipt recorded. Accepted stock is in store; rejected material is in quarantine.');
  });
}
export async function addWoItemAction(woId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'subcontract:create', idem: idem(fd) }, ({ ctx, q }) => sub.addWoItem(q, ctx, { workOrderId: woId, boqItemId: str(fd, 'boq_item_id'), rate: money(fd, 'rate'), qtyLimit: qty(fd, 'qty_limit'), tolBp: int(fd, 'tolerance_bp', 0, 2000) })), 'Item added.'));
}
export async function addMeasurementAction(sheetId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'subcontract:create', idem: idem(fd) }, ({ ctx, q }) => sub.addMeasurement(q, ctx, { sheetId, woItemId: str(fd, 'wo_item_id'), location: str(fd, 'location'), measuredOn: date(fd, 'measured_on'), qty: qty(fd, 'qty') })), 'Measurement added.'));
}
export async function removeMeasurement(lineId: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'subcontract:edit' }, async ({ q }) => { const l = await one<any>(q, 'select s.status from measurement_lines l join measurement_sheets s on s.id = l.sheet_id where l.id = $1', [lineId]); need(l && ['draft', 'rejected'].includes(l.status), 'Only draft sheets can change.'); await q.query('delete from measurement_lines where id = $1', [lineId]); }), 'Measurement removed.');
}
export async function createSubBillAction(sheetId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => ok(await run({ perm: 'subcontract:create', idem: idem(fd) }, ({ ctx, q }) => sub.createSubBill(q, ctx, { sheetId, materialRecovery: str(fd, 'material') ? money(fd, 'material') : 0n, otherDeductions: str(fd, 'other') ? money(fd, 'other') : 0n, deductionReason: opt(fd, 'deduction_reason') ?? undefined })), 'Subcontract bill created with the deductions shown below.'));
}
export async function addVariationItem(vid: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const item = { code: str(fd, 'code'), description: str(fd, 'description'), unit: str(fd, 'unit'), qty: qty(fd, 'qty'), rate: str(fd, 'rate') ? money(fd, 'rate') : 0n, baseBoqItemId: opt(fd, 'base_boq_item_id') };
    need(item.code && item.description && item.unit, 'Code, description and unit are required.');
    if (!item.baseBoqItemId) need(item.rate > 0n, 'A new item needs a rate. To vary an existing BOQ item, choose it — its contract rate is applied automatically.');
    return ok(await run({ perm: 'variations:create', idem: idem(fd) }, async ({ ctx, q }) => {
      const ex = await many<any>(q, 'select * from variation_items where variation_id = $1', [vid]);
      await bill.saveVariationItems(q, ctx, vid, [...ex.map(i => ({ code: i.code, description: i.description, unit: i.unit, qty: milli(i.qty), rate: BigInt(i.rate_paise), baseBoqItemId: i.base_boq_item_id })), item]);
    }), 'Item added. Cost recalculated.');
  });
}
export async function removeVariationItem(vid: string, itemId: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'variations:create' }, async ({ ctx, q }) => {
    const ex = await many<any>(q, 'select * from variation_items where variation_id = $1 and id <> $2', [vid, itemId]);
    await bill.saveVariationItems(q, ctx, vid, ex.map(i => ({ code: i.code, description: i.description, unit: i.unit, qty: milli(i.qty), rate: BigInt(i.rate_paise), baseBoqItemId: i.base_boq_item_id })));
  }), 'Item removed.');
}
export async function addCorrectiveAction(ncrId: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'quality:edit', idem: idem(fd) }, ({ ctx, q }) => qual.addAction(q, ctx, ncrId, str(fd, 'action'), opt(fd, 'owner_user_id'), opt(fd, 'due_date'))), 'Corrective action assigned.');
}
export async function completeCorrectiveAction(actionId: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'quality:edit' }, ({ ctx, q }) => qual.completeAction(q, ctx, actionId, opt(fd, 'file_id'))), 'Marked done with evidence.');
}
export async function verifyCorrectiveAction(actionId: string, _: FormState, __: FormData): Promise<FormState> {
  return ok(await run({ perm: 'quality:approve' }, ({ ctx, q }) => qual.verifyAction(q, ctx, actionId)), 'Correction verified.');
}

// ---- drawings ---------------------------------------------------------------------------------
export async function addRevisionAction(drawingId: string, _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    const rev = str(fd, 'rev'); need(rev, 'Enter the revision label (e.g. A, B, P1).'); need(opt(fd, 'file_id'), 'Upload the drawing file first.');
    return ok(await run({ perm: 'drawings:create', idem: idem(fd) }, async ({ ctx, q }) => {
      const d = await one<any>(q, 'select * from drawings where id = $1', [drawingId]); need(d, 'Drawing not found.');
      await q.query(`insert into drawing_revisions(org_id, project_id, drawing_id, rev, file_id, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [ctx.orgId, d.project_id, drawingId, rev, str(fd, 'file_id'), opt(fd, 'note'), ctx.userId]);
    }), 'Revision added as a draft.');
  });
}
export async function revisionFlowAction(revId: string, step: 'review' | 'approve' | 'reject', _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: step === 'review' ? 'drawings:edit' : 'drawings:approve' }, async ({ ctx, q }) => {
    const r = await one<any>(q, 'select * from drawing_revisions where id = $1 for update', [revId]); need(r, 'Revision not found.');
    if (step === 'review') { need(r.status === 'draft', 'Only a draft can go to review.'); await q.query(`update drawing_revisions set status='in_review' where id=$1`, [revId]); }
    else if (step === 'reject') { need(r.status === 'in_review', 'Only a revision in review can be rejected.'); needReason(str(fd, 'reason'), 'a reason'); await q.query(`update drawing_revisions set status='rejected', note = coalesce(note,'') || ' [Rejected: ' || $2 || ']' where id=$1`, [revId, str(fd, 'reason')]); }
    else {
      need(r.status === 'in_review', 'Only a revision in review can be approved.');
      await q.query(`update drawing_revisions set status='superseded' where drawing_id=$1 and status='approved'`, [r.drawing_id]);
      await q.query(`update drawing_revisions set status='approved', reviewed_by=$2, approved_at=now() where id=$1`, [revId, ctx.userId]);
    }
    await audit(q, { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, action: `drawing.${step}`, entity: 'drawing_revisions', entityId: revId });
  }), step === 'approve' ? 'Approved. Earlier revisions are now marked superseded.' : 'Done.');
}
export async function addTransmittalItem(txId: string, _: FormState, fd: FormData): Promise<FormState> {
  return ok(await run({ perm: 'drawings:edit', idem: idem(fd) }, async ({ ctx, q }) => {
    const t = await one<any>(q, 'select * from transmittals where id = $1', [txId]); need(t?.status === 'draft', 'Only a draft transmittal can change.');
    await q.query(`insert into transmittal_items(org_id, project_id, transmittal_id, drawing_revision_id, created_by) values ($1,$2,$3,$4,$5)`, [ctx.orgId, t.project_id, txId, str(fd, 'drawing_revision_id'), ctx.userId]);
  }), 'Revision added to the transmittal.');
}
