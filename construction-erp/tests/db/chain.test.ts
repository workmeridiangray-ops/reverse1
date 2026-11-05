import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeOrg, makeUser, withTenant, owner } from './helpers';
import type { Ctx } from '@/lib/db';
import * as est from '@/lib/domain/estimating';
import * as con from '@/lib/domain/contracts';
import * as plan from '@/lib/domain/planning';
import * as proc from '@/lib/domain/procurement';
import * as site from '@/lib/domain/site';
import * as qual from '@/lib/domain/quality';
import * as bill from '@/lib/domain/billing';
import * as sub from '@/lib/domain/subcontract';
import * as ho from '@/lib/domain/handover';
import { parseMoney as M, parseQty as Q } from '@/lib/rules/money';

afterAll(async () => { await owner.end(); });
const R = (n: number) => String(n * 100);          // rupees -> paise string
const one = async <T = any>(ctx: Ctx, sql: string, p: any[] = []) => withTenant(ctx, async q => (await q.query(sql, p)).rows[0] as T);
const rows = async <T = any>(ctx: Ctx, sql: string, p: any[] = []) => withTenant(ctx, async q => (await q.query(sql, p)).rows as T[]);

let O: Ctx, ENG: Ctx, QS: Ctx, SUP: Ctx, MGR: Ctx;
let orgId: string, projectId: string, contractId: string, site1: string, site2: string, supplier: string, subcon: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const a = await makeOrg('chain'); O = a.ctx; orgId = a.orgId;
  await withTenant({ userId: '', orgId, role: 'system' }, q => q.query(`update subscriptions set plan_id = (select id from plans where code='scale') where org_id = $1`, [orgId]));
});

describe('1 Tender, estimate, award, budget', () => {
  it('imports a BOQ with row validation and builds up a rate', async () => {
    const parties = await withTenant(O, async q => (await q.query(`insert into parties(org_id, kind, name) values ($1,'client','Skyline Developers'),($1,'supplier','Apex Cement'),($1,'subcontractor','Rapid Civil') returning id, kind`, [orgId])).rows);
    ids.client = parties.find(p => p.kind === 'client').id; supplier = parties.find(p => p.kind === 'supplier').id; subcon = parties.find(p => p.kind === 'subcontractor').id;
    const opp = await one(O, `insert into opportunities(org_id, name, client_party_id) values ($1,'Tower A Civil',$2) returning id`, [orgId, ids.client]);
    const rev = await withTenant(O, q => est.newRevision(q, O, opp.id)); ids.opp = opp.id; ids.rev = rev.id;
    const bad = await withTenant(O, q => est.importEstimateCsv(q, O, rev.id, 'code,description,unit,qty,rate\nA1,Excavation,m3,1000,500\nB1,Concrete M25,m3,400,6000\nX,bad,parsec,1,1'));
    expect(bad.imported).toBe(0); expect(bad.errors[0].row).toBe(4);
    const ok = await withTenant(O, q => est.importEstimateCsv(q, O, rev.id, 'code,description,unit,qty,rate\nA1,Excavation,m3,1000,500\nB1,Concrete M25,m3,400,6000'));
    expect(ok.imported).toBe(2);
    const b1 = await one(O, `select id from estimate_items where revision_id = $1 and code = 'B1'`, [rev.id]);
    const rate = await withTenant(O, q => est.buildUpRate(q, O, b1.id, '3500', '1000', '500'));
    expect(rate).toBe(M('5500'));                      // (3500+1000+500) + 10% overhead
  });
  it('awards: project, BOQ, and a baseline that keeps tender price, cost budget and contingency apart', async () => {
    await withTenant(O, q => est.approveRevision(q, O, ids.rev));
    const lim = { projects: 50 };
    await expect(withTenant(O, q => est.awardOpportunity(q, O, { oppId: ids.opp, revisionId: '00000000-0000-0000-0000-000000000000', code: 'TWR-A', name: 'Tower A', contingencyBp: 500, limits: lim }))).rejects.toThrow(/approved/);
    const r = await withTenant(O, q => est.awardOpportunity(q, O, { oppId: ids.opp, revisionId: ids.rev, code: 'TWR-A', name: 'Tower A', contingencyBp: 500, limits: lim }));
    projectId = r.project.id;
    expect(r.tender).toBe(M('2700000')); expect(r.budget).toBe(M('2500000')); expect(r.contingency).toBe(M('125000'));
    await expect(withTenant(O, q => est.awardOpportunity(q, O, { oppId: ids.opp, revisionId: ids.rev, code: 'X', name: 'X', contingencyBp: 0, limits: lim }))).rejects.toThrow(/already been awarded/);
    const s = await withTenant(O, async q => (await q.query(`insert into wbs_nodes(org_id, project_id, kind, code, name) values ($1,$2,'site','S1','Main block'),($1,$2,'site','S2','Annex') returning id, code`, [orgId, projectId])).rows);
    site1 = s.find(x => x.code === 'S1').id; site2 = s.find(x => x.code === 'S2').id;
    ids.boqA = (await one(O, `select id from boq_items where project_id=$1 and code='A1'`, [projectId])).id;
    ids.boqB = (await one(O, `select id from boq_items where project_id=$1 and code='B1'`, [projectId])).id;
    ENG = (await makeUser(orgId, 'engineer', projectId)).ctx; QS = (await makeUser(orgId, 'qs', projectId)).ctx; SUP = (await makeUser(orgId, 'supervisor', projectId)).ctx; MGR = (await makeUser(orgId, 'manager')).ctx;
  });
  it('plan limit blocks awarding beyond the project allowance', async () => {
    const opp = await one(O, `insert into opportunities(org_id, name) values ($1,'Second') returning id`, [orgId]);
    const rev = await withTenant(O, q => est.newRevision(q, O, opp.id)); await withTenant(O, q => est.importEstimateCsv(q, O, rev.id, 'code,description,unit,qty,rate\nZ,Z,m,1,1')); await withTenant(O, q => est.approveRevision(q, O, rev.id));
    await expect(withTenant(O, q => est.awardOpportunity(q, O, { oppId: opp.id, revisionId: rev.id, code: 'T2', name: 'T2', contingencyBp: 0, limits: { projects: 1 } }))).rejects.toThrow(/allows 1 active projects/);
  });
});

describe('2 Contract, advance, schedule', () => {
  it('activates a contract snapshot and limits the advance', async () => {
    contractId = (await one(O, `insert into contracts(org_id, project_id, number, title, advance_bp, advance_recovery_bp, retention_bp, payment_days) values ($1,$2,'C-1','Main contract',1000,1000,500,30) returning id`, [orgId, projectId])).id;
    await withTenant(O, q => con.activateContract(q, O, contractId));
    const c = await one(O, 'select value_paise, status, snapshot from contracts where id = $1', [contractId]);
    expect(c.value_paise).toBe(R(2700000)); expect(c.snapshot.boq).toHaveLength(2);
    await expect(withTenant(O, q => con.recordAdvance(q, O, contractId, M('270000.01')))).rejects.toThrow(/allows an advance/);
    await withTenant(O, q => con.recordAdvance(q, O, contractId, M('270000')));
    expect((await withTenant(O, q => con.ledgerBalance(q, contractId))).advanceOutstanding).toBe(M('270000'));
    await withTenant(O, q => q.query(`update boq_items set rate_paise = 1 where id = $1`, [ids.boqA]));   // later edit cannot rewrite the snapshot
    expect((await one(O, 'select snapshot from contracts where id = $1', [contractId])).snapshot.boq[0].rate_paise).toBe('50000');
    await withTenant(O, q => q.query(`update boq_items set rate_paise = 50000 where id = $1`, [ids.boqA]));
  });
  it('rejects dependency loops and reports conflicts; baseline is versioned', async () => {
    const mk = (code: string, s: string, f: string, extra = '') => one(O, `insert into activities(org_id, project_id, code, name, start_date, finish_date, planned_qty, boq_item_id ${extra ? ',' + extra.split('=')[0] : ''}) values ($1,$2,$3,$3,$4,$5,100,$6 ${extra ? ',' + extra.split('=')[1] : ''}) returning id`, [orgId, projectId, code, s, f, ids.boqA]);
    const a1 = await mk('ACT-1', '2026-01-01', '2026-01-10'), a2 = await mk('ACT-2', '2026-01-05', '2026-01-20'), a3 = await mk('ACT-3', '2026-01-21', '2026-01-30', 'requires_hold_release=true');
    ids.act1 = a1.id; ids.act2 = a2.id; ids.act3 = a3.id;
    await withTenant(O, q => plan.addDependency(q, O, projectId, a1.id, a2.id, 0));
    await withTenant(O, q => plan.addDependency(q, O, projectId, a2.id, a3.id, 0));
    await expect(withTenant(O, q => plan.addDependency(q, O, projectId, a3.id, a1.id, 0))).rejects.toThrow(/loop/);
    const chk = await withTenant(O, q => plan.scheduleCheck(q, projectId));
    expect(chk.violations.map(v => v.succ)).toEqual([a2.id]);          // ACT-2 starts before ACT-1 finishes
    await expect(withTenant(O, q => plan.approveBaseline(q, O, projectId, 'x'))).rejects.toThrow(/dependency conflicts/);
    await withTenant(O, q => plan.reschedule(q, O, a2.id, '2026-01-11', '2026-01-20', 'Predecessor overran'));
    expect(await withTenant(O, q => plan.approveBaseline(q, O, projectId, 'Baseline 1'))).toBe(1);
    await withTenant(O, q => plan.reschedule(q, O, a3.id, '2026-02-01', '2026-02-10', 'Material delay'));
    const act = await one(O, `select base_finish::text bf, finish_date::text f from activities where id = $1`, [a3.id]);
    expect(act.bf).toBe('2026-01-30'); expect(act.f).toBe('2026-02-10');   // history not rewritten
  });
});

describe('3 Procurement, stores', () => {
  let mr: string, po: any;
  it('MR → approval → RFQ → quotes → PO with authority and budget checks', async () => {
    mr = (await one(ENG, `insert into material_requests(org_id, project_id, number, activity_id, site_id, created_by) values ($1,$2,'MR-1',$3,$4,$5) returning id`, [orgId, projectId, ids.act1, site1, ENG.userId])).id;
    await expect(withTenant(ENG, q => proc.submitMR(q, ENG, mr))).rejects.toThrow(/at least one line/);
    await one(ENG, `insert into mr_lines(org_id, project_id, mr_id, item_code, description, unit, qty, boq_item_id) values ($1,$2,$3,'CEM','Cement OPC 53','bag',100,$4) returning id`, [orgId, projectId, mr, ids.boqB]);
    await withTenant(ENG, q => proc.submitMR(q, ENG, mr));
    await expect(withTenant(ENG, q => proc.decideMR(q, ENG, mr, true))).rejects.toThrow(/own request/);
    await withTenant(MGR, q => proc.decideMR(q, MGR, mr, true));
    const rfq = await withTenant(ENG, q => proc.createRfq(q, ENG, mr));
    const line = await one(ENG, 'select id from mr_lines where mr_id = $1', [mr]);
    const sup2 = (await one(O, `insert into parties(org_id, kind, name) values ($1,'supplier','Budget Bags') returning id`, [orgId])).id;
    await withTenant(ENG, q => proc.addQuote(q, ENG, rfq.id, supplier, { [line.id]: M('400') }, 3));
    await withTenant(ENG, q => proc.addQuote(q, ENG, rfq.id, sup2, { [line.id]: M('380') }, 7));
    const cmp = await withTenant(ENG, q => proc.comparison(q, rfq.id));
    expect(cmp.map(c => c.supplier)).toEqual(['Budget Bags', 'Apex Cement']);   // cheapest first
    po = await withTenant(ENG, q => proc.poFromQuote(q, ENG, cmp[1].id, '2026-02-01'));   // chosen: Apex (faster)
    expect(po.total_paise).toBe(R(40000));
    await expect(withTenant(ENG, q => proc.approvePO(q, ENG, po.id))).rejects.toThrow(/delegated|authority/);
    await withTenant(MGR, q => proc.approvePO(q, MGR, po.id));
    await withTenant(MGR, q => proc.issuePO(q, MGR, po.id));
  });
  it('partial delivery with rejection → quarantine; over-receipt blocked; replacement expectation required', async () => {
    const pl = await one(ENG, 'select id from po_lines where po_id = $1', [po.id]);
    await expect(withTenant(ENG, q => proc.receiveGoods(q, ENG, { poId: po.id, siteId: site1, receivedOn: '2026-02-02', lines: [{ poLineId: pl.id, received: Q('60'), accepted: Q('50'), rejected: Q('10'), reason: 'Lumps', expectation: 'none' }] }))).rejects.toThrow(/replaced or credited/);
    await expect(withTenant(ENG, q => proc.receiveGoods(q, ENG, { poId: po.id, siteId: site1, receivedOn: '2026-02-02', lines: [{ poLineId: pl.id, received: Q('60'), accepted: Q('40'), rejected: Q('10'), reason: 'Lumps', expectation: 'credit' }] }))).rejects.toThrow(/equal received/);
    await withTenant(ENG, q => proc.receiveGoods(q, ENG, { poId: po.id, siteId: site1, receivedOn: '2026-02-02', lines: [{ poLineId: pl.id, received: Q('60'), accepted: Q('50'), rejected: Q('10'), reason: 'Lumps', expectation: 'replacement' }] }));
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site1, 'CEM'))).toBe(Q('50'));
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site1, 'CEM', 'quarantine'))).toBe(Q('10'));
    await expect(withTenant(ENG, q => proc.receiveGoods(q, ENG, { poId: po.id, siteId: site1, receivedOn: '2026-02-03', lines: [{ poLineId: pl.id, received: Q('50'), accepted: Q('50'), rejected: 0n }] }))).rejects.toThrow(/exceeds the quantity ordered/);
    expect((await one(ENG, 'select status from purchase_orders where id = $1', [po.id])).status).toBe('part_received');
  });
  it('issue, transfer, return, count — balances stay exact and cannot go negative', async () => {
    await expect(withTenant(SUP, q => proc.issueStock(q, SUP, { projectId, siteId: site1, itemCode: 'CEM', qty: Q('70') }))).rejects.toThrow(/available/);
    // concurrent issues: only what is on hand may leave
    const res = await Promise.allSettled([40, 40, 40].map(n => withTenant(SUP, q => proc.issueStock(q, SUP, { projectId, siteId: site1, itemCode: 'CEM', qty: Q(String(n)), activityId: ids.act1 }))));
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site1, 'CEM'))).toBe(Q('10'));
    const tr = await withTenant(ENG, q => proc.dispatchTransfer(q, ENG, { projectId, fromSiteId: site1, toSiteId: site2, lines: [{ itemCode: 'CEM', qty: Q('6') }] }));
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site1, 'CEM'))).toBe(Q('4'));
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site2, 'CEM'))).toBe(0n);   // in transit: not yet at destination
    await withTenant(ENG, q => proc.receiveTransfer(q, ENG, tr.id));
    await expect(withTenant(ENG, q => proc.receiveTransfer(q, ENG, tr.id))).rejects.toThrow(/not in transit/);
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site2, 'CEM'))).toBe(Q('6'));
    await withTenant(ENG, q => proc.returnToSupplier(q, ENG, { projectId, siteId: site1, itemCode: 'CEM', qty: Q('10'), note: 'Debit note DN-77' }));
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site1, 'CEM', 'quarantine'))).toBe(0n);
    await expect(withTenant(ENG, q => proc.returnToStore(q, ENG, { projectId, siteId: site1, itemCode: 'CEM', qty: Q('100') }))).rejects.toThrow(/more than has been issued/);
    const cnt = (await one(ENG, `insert into stock_counts(org_id, project_id, site_id) values ($1,$2,$3) returning id`, [orgId, projectId, site1])).id;
    await one(ENG, `insert into stock_count_lines(org_id, project_id, count_id, item_code, unit, system_qty, counted_qty) values ($1,$2,$3,'CEM','bag',4,2) returning id`, [orgId, projectId, cnt]);
    await withTenant(ENG, q => proc.applyStockCount(q, ENG, cnt));
    expect(await withTenant(ENG, q => proc.stockOnHand(q, projectId, site1, 'CEM'))).toBe(Q('2'));
  });
  it('reconciles committed purchasing with the cost budget; over-budget needs a manager and a reason', async () => {
    const rec = await withTenant(ENG, q => proc.budgetReconciliation(q, projectId));
    const b1 = rec.find(r => r.code === 'B1')!;
    expect(b1.pos.committed).toBe(M('40000')); expect(b1.pos.budget).toBe(M('2000000'));
    const big = (await one(ENG, `insert into purchase_orders(org_id, project_id, number, supplier_id, total_paise, created_by) values ($1,$2,'PO-BIG',$3,$4,$5) returning id`, [orgId, projectId, supplier, R(2100000), ENG.userId])).id;
    await one(ENG, `insert into po_lines(org_id, project_id, po_id, boq_item_id, item_code, description, unit, qty, rate_paise) values ($1,$2,$3,$4,'RMC','Ready mix','m3',420,$5) returning id`, [orgId, projectId, big, ids.boqB, R(5000)]);
    await expect(withTenant(O, q => proc.approvePO(q, O, big))).rejects.toThrow(/reason/);
    await withTenant(O, q => proc.approvePO(q, O, big, 'Rate escalation agreed with client'));
    expect((await one(O, 'select status, override_reason from purchase_orders where id = $1', [big])).override_reason).toMatch(/escalation/);
  });
});

describe('4 Site execution, quality hold points', () => {
  let rep: any;
  it('daily report: draft, concurrent edit detection, submit, hold-point block, verified vs claimed', async () => {
    const input = (extra: Partial<site.ReportInput> = {}): site.ReportInput => ({ projectId, siteId: site1, date: '2026-02-05', weather: 'Clear', labour: [{ trade: 'Mason', headcount: 8, hours: 8 }], equipment: [{ name: 'JCB', hours: 6, idle: 2 }],
      quantities: [{ activityId: ids.act3, claimed: '30' }], issues: [], photos: [], ...extra });
    rep = await withTenant(SUP, q => site.saveReport(q, SUP, input()));
    await expect(withTenant(SUP, q => site.saveReport(q, SUP, input()))).rejects.toThrow(/already exists/);
    const again = await withTenant(SUP, q => site.saveReport(q, SUP, { ...input({ notes: 'second save' }), id: rep.id, version: rep.version }));
    await expect(withTenant(SUP, q => site.saveReport(q, SUP, { ...input({ notes: 'stale tab' }), id: rep.id, version: rep.version }))).rejects.toThrow(/Someone else changed/);
    rep = again;
    await expect(withTenant(SUP, q => site.saveReport(q, SUP, input({ date: '2999-01-01', siteId: site2 })))).rejects.toThrow(/future/);
    await withTenant(SUP, q => site.submitReport(q, SUP, rep.id));
    await expect(withTenant(SUP, q => site.saveReport(q, SUP, { ...input(), id: rep.id, version: 99 }))).rejects.toThrow(/submitted/);
    const line = await one(ENG, 'select id from report_quantities where report_id = $1', [rep.id]);
    await expect(withTenant(SUP, q => site.verifyReport(q, SUP, rep.id, { [line.id]: { qty: '30' } }))).rejects.toThrow(/other than the author/);
    await expect(withTenant(ENG, q => site.verifyReport(q, ENG, rep.id, { [line.id]: { qty: '30' } }))).rejects.toThrow(/hold point/);
    const insp = (await one(ENG, `insert into inspections(org_id, project_id, number, title, activity_id, hold_point) values ($1,$2,'INS-1','Rebar check before pour',$3,true) returning id`, [orgId, projectId, ids.act3])).id;
    await expect(withTenant(ENG, q => qual.decideInspection(q, ENG, insp, 'waived', 'urgent'))).rejects.toThrow(/manager/);
    await withTenant(MGR, q => qual.decideInspection(q, MGR, insp, 'passed', 'Cover and spacing as per drawing; checked by RE'));
    await expect(withTenant(ENG, q => site.verifyReport(q, ENG, rep.id, { [line.id]: { qty: '25' } }))).rejects.toThrow(/explanation/);
    await withTenant(ENG, q => site.verifyReport(q, ENG, rep.id, { [line.id]: { qty: '25', reason: 'Only 25 m3 poured: truck breakdown' } }));
    const v = await one(ENG, `select claimed_qty, verified_qty, correction_reason from report_quantities where id = $1`, [line.id]);
    expect(v).toMatchObject({ claimed_qty: '30.000', verified_qty: '25.000' });
    expect((await one(ENG, 'select done_qty, status from activities where id = $1', [ids.act3]))).toMatchObject({ done_qty: '25.000', status: 'in_progress' });
  });
  it('failed inspection raises an NCR that needs verified evidence before it can close', async () => {
    const insp = (await one(ENG, `insert into inspections(org_id, project_id, number, title) values ($1,$2,'INS-2','Slab level') returning id`, [orgId, projectId])).id;
    await withTenant(ENG, q => qual.decideInspection(q, ENG, insp, 'failed', 'Level off by 15mm'));
    const ncr = await one(ENG, `select id from ncrs where inspection_id = $1`, [insp]);
    await withTenant(ENG, q => qual.addAction(q, ENG, ncr.id, 'Grind and re-level', ENG.userId, '2026-03-01'));
    const act = await one(ENG, 'select id from corrective_actions where ncr_id = $1', [ncr.id]);
    await expect(withTenant(ENG, q => qual.completeAction(q, ENG, act.id, null))).rejects.toThrow(/evidence/);
    const f = (await one(ENG, `insert into files(org_id, name, mime, size_bytes, sha256, storage_key) values ($1,'fix.jpg','image/jpeg',10,'x',$2) returning id`, [orgId, 'k' + Math.random()])).id;
    await withTenant(ENG, q => qual.completeAction(q, ENG, act.id, f));
    await expect(withTenant(ENG, q => qual.verifyAction(q, ENG, act.id))).rejects.toThrow(/someone other/);
    await withTenant(MGR, q => qual.verifyAction(q, MGR, act.id));
    await withTenant(MGR, q => qual.closeNcr(q, MGR, ncr.id));
    expect((await one(O, 'select status from ncrs where id = $1', [ncr.id])).status).toBe('closed');
  });
});

describe('5 Subcontract measurement and billing', () => {
  it('prevents duplicate / excess measurements, enforces three-person approval and shows deductions', async () => {
    const wo = (await one(QS, `insert into work_orders(org_id, project_id, subcontractor_id, number, retention_bp, advance_paise, advance_recovery_bp, status) values ($1,$2,$3,'WO-1',500,$4,1000,'draft') returning id`, [orgId, projectId, subcon, R(10000)])).id;
    await expect(withTenant(QS, q => sub.addWoItem(q, QS, { workOrderId: wo, boqItemId: ids.boqA, rate: M('450'), qtyLimit: Q('1200'), tolBp: 500 }))).rejects.toThrow(/remains to be subcontracted/);
    await withTenant(QS, q => sub.addWoItem(q, QS, { workOrderId: wo, boqItemId: ids.boqA, rate: M('450'), qtyLimit: Q('500'), tolBp: 500 }));
    const it = await one(QS, 'select id from wo_items where work_order_id = $1', [wo]);
    const sheet = (await one(QS, `insert into measurement_sheets(org_id, project_id, work_order_id, number, period_to) values ($1,$2,$3,'MS-1','2026-02-28') returning id`, [orgId, projectId, wo])).id;
    await withTenant(QS, q => sub.addMeasurement(q, QS, { sheetId: sheet, woItemId: it.id, location: 'Grid A-C', measuredOn: '2026-02-20', qty: Q('300') }));
    await expect(withTenant(QS, q => sub.addMeasurement(q, QS, { sheetId: sheet, woItemId: it.id, location: 'Grid A-C', measuredOn: '2026-02-20', qty: Q('10') }))).rejects.toThrow(/already been measured/);
    await expect(withTenant(QS, q => sub.addMeasurement(q, QS, { sheetId: sheet, woItemId: it.id, location: 'Grid D-F', measuredOn: '2026-02-21', qty: Q('226') }))).rejects.toThrow(/exceeds permitted/);   // 300+226 > 525
    await withTenant(QS, q => sub.advanceSheet(q, QS, sheet, 'prepare'));
    await expect(withTenant(QS, q => sub.advanceSheet(q, QS, sheet, 'verify'))).rejects.toThrow(/cannot verify their own/);
    await withTenant(ENG, q => sub.advanceSheet(q, ENG, sheet, 'verify'));
    await expect(withTenant(ENG, q => sub.advanceSheet(q, ENG, sheet, 'approve'))).rejects.toThrow(/other than the preparer and verifier/);
    await withTenant(MGR, q => sub.advanceSheet(q, MGR, sheet, 'approve'));
    await expect(withTenant(QS, q => sub.createSubBill(q, QS, { sheetId: sheet, materialRecovery: M('5000'), otherDeductions: 0n }))).rejects.toThrow(/reason/);
    const b = await withTenant(QS, q => sub.createSubBill(q, QS, { sheetId: sheet, materialRecovery: M('5000'), otherDeductions: 0n, deductionReason: 'Cement issued free of cost' }));
    expect(b).toMatchObject({ gross_paise: R(135000), retention_paise: R(6750), advance_recovery_paise: R(10000), material_recovery_paise: R(5000), net_paise: R(113250) });
    await expect(withTenant(QS, q => sub.createSubBill(q, QS, { sheetId: sheet, materialRecovery: 0n, otherDeductions: 0n }))).rejects.toThrow(/approved measurement sheet|duplicate|unique/);
    await expect(withTenant(QS, q => sub.approveSubBill(q, QS, b.id))).rejects.toThrow(/delegated|authority/);
    await withTenant(MGR, q => sub.approveSubBill(q, MGR, b.id));
  });
});

describe('6 Client billing: measurement book → certified bill → invoice → collection', () => {
  let bill1: any, bill2: any, inv1: any;
  it('bill 1: only verified measurements are billed; deductions are visible', async () => {
    const add = (item: string, loc: string, qty: string) => withTenant(QS, q => bill.addMeasurementBook(q, QS, { projectId, boqItemId: item, location: loc, measuredOn: '2026-02-25', qty: Q(qty) }));
    await add(ids.boqA, 'Zone 1', '400'); await add(ids.boqB, 'Zone 1', '100');
    await expect(add(ids.boqA, 'Zone 1', '5')).rejects.toThrow(/duplicate/);
    await expect(withTenant(QS, q => bill.createBill(q, QS, contractId, '2026-02-28'))).rejects.toThrow(/no verified/);
    for (const m of await rows(QS, 'select id from measurement_book')) {
      await expect(withTenant(QS, q => bill.verifyMeasurementBook(q, QS, m.id))).rejects.toThrow(/other than the recorder/);
      await withTenant(ENG, q => bill.verifyMeasurementBook(q, ENG, m.id));
    }
    bill1 = await withTenant(QS, q => bill.createBill(q, QS, contractId, '2026-02-28'));
    expect(bill1.submitted_paise).toBe(R(750000));
    await expect(withTenant(QS, q => bill.createBill(q, QS, contractId, '2026-03-31'))).rejects.toThrow(/still open/);
    await withTenant(QS, q => bill.submitBill(q, QS, bill1.id));
    await expect(withTenant(QS, q => bill.certifyBill(q, QS, bill1.id, null, null))).rejects.toThrow(/certificate reference/);
    await withTenant(QS, q => bill.certifyBill(q, QS, bill1.id, null, 'CERT/2026/01'));
    const b = await one(O, 'select * from ra_bills where id = $1', [bill1.id]);
    expect(b).toMatchObject({ status: 'certified', certified_gross_paise: R(750000), advance_recovery_paise: R(75000), retention_paise: R(37500), net_certified_paise: R(637500) });
  });
  it('invoice, partial receipts, disputes, overpayment and duplicate receipts', async () => {
    inv1 = await withTenant(QS, q => bill.invoiceBill(q, QS, bill1.id));
    expect(inv1.amount_paise).toBe(R(637500));
    const led = await withTenant(O, q => con.ledgerBalance(q, contractId));
    expect(led).toMatchObject({ advanceRecovered: M('75000'), retentionHeld: M('37500') });
    const pay = (amt: string, ref: string) => withTenant(QS, q => bill.recordReceipt(q, QS, { invoiceId: inv1.id, amount: M(amt), receivedOn: '2026-03-10', method: 'bank', reference: ref }));
    expect(await pay('400000', 'UTR-1001')).toBe('part_paid');
    await expect(pay('400000', 'UTR-1001')).rejects.toThrow(/already recorded|outstanding/);
    await expect(pay('300000', 'UTR-1002')).rejects.toThrow(/outstanding/);
    await withTenant(QS, q => bill.raiseDispute(q, QS, inv1.id, M('50000'), 'Quantity of B1 disputed'));
    expect((await one(O, 'select status from invoices where id = $1', [inv1.id])).status).toBe('disputed');
    expect(await pay('187500', 'UTR-1003')).toBe('disputed');   // still 50,000 under dispute
    const d = await one(O, 'select id from disputes limit 1');
    await expect(withTenant(QS, q => bill.resolveDispute(q, QS, d.id, 'written_off', 'ok'))).rejects.toThrow(/manager/);
    await withTenant(MGR, q => bill.resolveDispute(q, MGR, d.id, 'written_off', 'Settled by negotiation: credit note CN-5'));
    expect(await one(O, 'select status, collected_paise, written_off_paise from invoices where id = $1', [inv1.id])).toMatchObject({ status: 'settled', collected_paise: R(587500), written_off_paise: R(50000) });
  });
  it('bill 2: cumulative, partial certification, recoveries on cumulative gross', async () => {
    const add = (item: string, loc: string, qty: string) => withTenant(QS, q => bill.addMeasurementBook(q, QS, { projectId, boqItemId: item, location: loc, measuredOn: '2026-03-25', qty: Q(qty) }));
    await add(ids.boqA, 'Zone 2', '200'); await add(ids.boqB, 'Zone 2', '100');
    for (const m of await rows(QS, `select id from measurement_book where status = 'draft'`)) await withTenant(ENG, q => bill.verifyMeasurementBook(q, ENG, m.id));
    bill2 = await withTenant(QS, q => bill.createBill(q, QS, contractId, '2026-03-31'));
    expect(bill2.submitted_paise).toBe(R(650000)); expect(bill2.prev_certified_gross_paise).toBe(R(750000));
    await withTenant(QS, q => bill.submitBill(q, QS, bill2.id));
    const lines = await rows(QS, 'select l.id, b.code from ra_bill_lines l join boq_items b on b.id = l.boq_item_id where bill_id = $1', [bill2.id]);
    const lb = lines.find(l => l.code === 'B1')!;
    await expect(withTenant(QS, q => bill.certifyBill(q, QS, bill2.id, { [lb.id]: '60' }, 'CERT/2026/02'))).rejects.toThrow(/reason for certifying less/);
    const calc = await withTenant(QS, q => bill.certifyBill(q, QS, bill2.id, { [lb.id]: '60' }, 'CERT/2026/02', 'Client holds 40 m3 pending cube tests'));
    expect(calc.thisCertifiedGrossPaise).toBe(M('430000')); expect(calc.cumGrossPaise).toBe(M('1180000'));
    expect(calc.cumAdvanceRecoveryPaise).toBe(M('118000')); expect(calc.cumRetentionPaise).toBe(M('59000'));
    expect(calc.netPayablePaise).toBe(M('365500'));
    const f = await withTenant(QS, q => bill.financialPosition(q, projectId));
    expect(f.submitted).toBe(M('1400000')); expect(f.certified).toBe(M('1180000')); expect(f.invoiced).toBe(M('637500')); expect(f.collected).toBe(M('587500'));
  });
  it('a rejected bill releases its measurements; over-BOQ claims are refused', async () => {
    const inv2 = await withTenant(QS, q => bill.invoiceBill(q, QS, bill2.id));
    expect(inv2.amount_paise).toBe(R(365500));
    // B1 certified so far: 100 + 60 = 160 of 400. Claiming 300 more (460 > 400) must be refused until a variation is approved.
    await withTenant(QS, q => bill.addMeasurementBook(q, QS, { projectId, boqItemId: ids.boqB, location: 'Zone 3', measuredOn: '2026-04-20', qty: Q('300') }));
    const m = await one(QS, `select id from measurement_book where location = 'Zone 3'`); await withTenant(ENG, q => bill.verifyMeasurementBook(q, ENG, m.id));
    await expect(withTenant(QS, q => bill.createBill(q, QS, contractId, '2026-04-30'))).rejects.toThrow(/exceeds BOQ quantity/);
    await withTenant(QS, q => q.query(`update measurement_book set qty = 200 where location = 'Zone 3'`));
    await withTenant(QS, q => bill.createBill(q, QS, contractId, '2026-04-30'));
    const b3 = await one(QS, 'select id from ra_bills where bill_no = 3');
    await withTenant(QS, q => bill.submitBill(q, QS, b3.id));
    await withTenant(MGR, q => bill.rejectBill(q, MGR, b3.id, 'Quantities not yet measured jointly'));
    expect((await one(QS, 'select status, bill_id from measurement_book where location = $1', ['Zone 3']))).toMatchObject({ status: 'verified', bill_id: null });
  });
  it('variations: original rate preserved, approval needs a decision, applying updates BOQ and contract once', async () => {
    const v = (await one(QS, `insert into variations(org_id, project_id, number, title, scope, time_delta_days, created_by) values ($1,$2,'VO-1','Extra footing','Additional footing at grid 7',5,$3) returning id`, [orgId, projectId, QS.userId])).id;
    const cost = await withTenant(QS, q => bill.saveVariationItems(q, QS, v, [
      { code: 'B1x', description: 'Extra concrete', unit: 'm3', qty: Q('20'), rate: M('9999'), baseBoqItemId: ids.boqB },   // user-typed rate is ignored: contract rate applies
      { code: 'N1', description: 'Waterproofing', unit: 'sqm', qty: Q('10'), rate: M('2000') }]));
    expect(cost).toBe(M('130000'));
    await withTenant(QS, q => bill.submitVariation(q, QS, v));
    await expect(withTenant(QS, q => bill.applyVariation(q, QS, v))).rejects.toThrow(/approved variation/);
    await withTenant(MGR, q => bill.recordVariationDecision(q, MGR, v, true, 'Client letter CL/55 dated 12 Apr'));
    await withTenant(MGR, q => bill.applyVariation(q, MGR, v));
    await expect(withTenant(MGR, q => bill.applyVariation(q, MGR, v))).rejects.toThrow(/already applied/);
    expect((await one(O, 'select qty from boq_items where id = $1', [ids.boqB])).qty).toBe('420.000');
    expect((await one(O, `select source, rate_paise from boq_items where code = 'VO-1-N1'`))).toMatchObject({ source: 'variation', rate_paise: R(2000) });
    expect((await one(O, 'select value_paise from contracts where id = $1', [contractId])).value_paise).toBe(R(2830000));
    // the rest of B1 is now billable: 420 − 160 certified = 260 available
  });
});

describe('7 Handover and closure', () => {
  it('blocks closure until snags, checklist, final account and collections are complete', async () => {
    await withTenant(O, q => ho.startHandover(q, O, projectId));
    const sn = (await one(SUP, `insert into snags(org_id, project_id, number, description, created_by) values ($1,$2,'SN-1','Paint patch lobby',$3) returning id`, [orgId, projectId, SUP.userId])).id;
    await expect(withTenant(O, q => ho.closeProject(q, O, projectId))).rejects.toThrow(/Close is blocked/);
    await expect(withTenant(SUP, q => ho.snagFlow(q, SUP, sn, 'verify'))).rejects.toThrow(/rectified/);
    await withTenant(SUP, q => ho.snagFlow(q, SUP, sn, 'rectify', 'Repainted and cured'));
    await withTenant(ENG, q => ho.snagFlow(q, ENG, sn, 'verify'));
    await withTenant(ENG, q => ho.snagFlow(q, ENG, sn, 'close'));
    for (const c of await rows(O, 'select id from completion_checklist')) await withTenant(O, q => q.query('update completion_checklist set done = true, evidence = $2 where id = $1', [c.id, 'filed']));
    const fa = await withTenant(O, q => ho.prepareFinalAccount(q, O, projectId));
    expect(fa.blockers).toEqual(expect.arrayContaining(['Advance not fully recovered']));
    await expect(withTenant(QS, q => ho.agreeFinalAccount(q, QS, projectId))).rejects.toThrow(/Outstanding items/);
    await withTenant(MGR, q => ho.agreeFinalAccount(q, MGR, projectId, 'Balance advance to be recovered from retention release'));
    await expect(withTenant(O, q => ho.closeProject(q, O, projectId))).rejects.toThrow(/outstanding balance/);
    const inv2 = await one(O, `select id from invoices where amount_paise = $1`, [R(365500)]);
    await withTenant(QS, q => bill.recordReceipt(q, QS, { invoiceId: inv2.id, amount: M('365500'), receivedOn: '2026-04-30', method: 'bank', reference: 'UTR-2001' }));
    await withTenant(O, q => ho.startDefectPeriod(q, O, projectId, '2026-05-01'));
    expect((await one(O, 'select dlp_end::text d from projects where id = $1', [projectId])).d).toBe('2027-05-01');
    await withTenant(O, q => ho.closeProject(q, O, projectId));
    await expect(withTenant(QS, q => bill.addMeasurementBook(q, QS, { projectId, boqItemId: ids.boqA, location: 'late', measuredOn: '2026-06-01', qty: Q('1') }))).rejects.toThrow(/closed/);
    await expect(withTenant(SUP, q => site.saveReport(q, SUP, { projectId, siteId: site1, date: '2026-06-02', labour: [{ trade: 'x', headcount: 1, hours: 1 }], equipment: [], quantities: [], issues: [], photos: [] }))).rejects.toThrow(/closed/);
    expect(Number((await one(O, 'select count(*) n from boq_items where project_id = $1', [projectId])).n)).toBeGreaterThan(0);   // still readable
  });
});

describe('8 Audit trail', () => {
  it('records the sensitive actions with actors and without secrets', async () => {
    const acts = (await rows(O, `select distinct action from audit_log where org_id = $1`, [orgId])).map(r => r.action);
    for (const a of ['tender.award', 'contract.activate', 'po.approve', 'bill.certify', 'invoice.create', 'receipt.create', 'variation.apply', 'project.close', 'db.update']) expect(acts).toContain(a);
    const all = JSON.stringify(await rows(O, 'select detail from audit_log'));
    expect(all).not.toMatch(/password|scrypt|token/i);
  });
});
