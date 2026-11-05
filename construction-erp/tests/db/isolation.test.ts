import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeOrg, makeUser, seedProject, withTenant, count, owner } from './helpers';

let A: Awaited<ReturnType<typeof makeOrg>>, B: Awaited<ReturnType<typeof makeOrg>>;
let pa: Awaited<ReturnType<typeof seedProject>>, pb: Awaited<ReturnType<typeof seedProject>>;

beforeAll(async () => {
  A = await makeOrg('alpha'); B = await makeOrg('beta');
  pa = await seedProject(A.ctx, 'ALPHA-1'); pb = await seedProject(B.ctx, 'BETA-1');
});
afterAll(async () => { await owner.end(); });

describe('tenant isolation (row-level security)', () => {
  it("never lists another company's rows", async () => {
    const rows = await withTenant(A.ctx, async q => (await q.query('select code from projects')).rows);
    expect(rows.map(r => r.code)).toEqual(['ALPHA-1']);
    expect(await withTenant(A.ctx, q => count(q, 'boq_items'))).toBe(1);
  });
  it('a guessed identifier from another company returns nothing', async () => {
    const r = await withTenant(A.ctx, q => q.query('select * from projects where id = $1', [pb.projectId]));
    expect(r.rowCount).toBe(0);
    const b = await withTenant(A.ctx, q => q.query('select * from boq_items where id = $1', [pb.boqId]));
    expect(b.rowCount).toBe(0);
  });
  it("cannot update or delete another company's rows", async () => {
    const u = await withTenant(A.ctx, q => q.query(`update boq_items set rate_paise = 1 where id = $1`, [pb.boqId]));
    expect(u.rowCount).toBe(0);
    const d = await withTenant(A.ctx, q => q.query(`delete from boq_items where id = $1`, [pb.boqId]));
    expect(d.rowCount).toBe(0);
    const still = await withTenant(B.ctx, q => q.query('select rate_paise from boq_items where id = $1', [pb.boqId]));
    expect(still.rows[0].rate_paise).toBe('500000');
  });
  it('cannot insert into another company', async () => {
    await expect(withTenant(A.ctx, q => q.query(`insert into parties(org_id, kind, name) values ($1,'supplier','x')`, [B.orgId]))).rejects.toThrow(/row-level security/);
  });
  it('cannot reference another company\'s record even with its exact id (cross-tenant FK guard)', async () => {
    const other = await withTenant(B.ctx, async q => (await q.query(`insert into parties(org_id, kind, name) values ($1,'supplier','Beta Supplier') returning id`, [B.orgId])).rows[0].id);
    await expect(withTenant(A.ctx, q => q.query(
      `insert into purchase_orders(org_id, project_id, number, supplier_id) values ($1,$2,'PO-1',$3)`, [A.orgId, pa.projectId, other]))).rejects.toThrow(/cross-tenant/);
  });
  it('a project of the same company with the wrong org_id on the row is rejected', async () => {
    await expect(withTenant(A.ctx, q => q.query(
      `insert into boq_items(org_id, project_id, code, description, unit, qty, rate_paise) values ($1,$2,'X','x','m',1,1)`, [B.orgId, pa.projectId]))).rejects.toThrow();
  });
  it('no tenant context means no rows at all', async () => {
    const r = await withTenant({ userId: '', orgId: null, role: 'none' }, q => q.query('select * from projects'));
    expect(r.rowCount).toBe(0);
  });
  it('platform staff see businesses but never operational data', async () => {
    const ctx = { userId: A.userId, orgId: null, role: 'platform' };
    expect(await withTenant(ctx, q => count(q, 'orgs'))).toBeGreaterThanOrEqual(2);
    expect(await withTenant(ctx, q => count(q, 'projects'))).toBe(0);
    expect(await withTenant(ctx, q => count(q, 'boq_items'))).toBe(0);
    expect(await withTenant(ctx, q => count(q, 'files'))).toBe(0);
  });
});

describe('roles and project scope', () => {
  it('staff only see projects they are assigned to', async () => {
    const p2 = await seedProject(A.ctx, 'ALPHA-2');
    const eng = await makeUser(A.orgId, 'engineer', p2.projectId);
    const rows = await withTenant(eng.ctx, async q => (await q.query('select code from projects')).rows);
    expect(rows.map(r => r.code)).toEqual(['ALPHA-2']);
    expect(await withTenant(eng.ctx, q => q.query('select * from boq_items where project_id = $1', [pa.projectId])).then(r => r.rowCount)).toBe(0);
  });
  it('branch assignment narrows what a manager sees', async () => {
    const br = await withTenant(A.ctx, async q => (await q.query(`insert into branches(org_id, name, code) values ($1,'Pune','PNQ') returning id`, [A.orgId])).rows[0].id);
    const p = await seedProject(A.ctx, 'ALPHA-PNQ');
    await withTenant(A.ctx, q => q.query('update projects set branch_id = $1 where id = $2', [br, p.projectId]));
    const mgr = await makeUser(A.orgId, 'manager');
    await withTenant({ userId: '', orgId: A.orgId, role: 'system' }, q => q.query('update memberships set branch_ids = $1 where user_id = $2', [[br], mgr.userId]));
    const seen = await withTenant(mgr.ctx, async q => (await q.query('select code from projects')).rows.map(r => r.code));
    expect(seen).toEqual(['ALPHA-PNQ']);
  });
  it('viewers cannot write', async () => {
    const v = await makeUser(A.orgId, 'viewer', pa.projectId);
    await expect(withTenant(v.ctx, q => q.query(`update boq_items set qty = 5 where id = $1`, [pa.boqId]))).resolves.toMatchObject({ rowCount: 0 });
    await expect(withTenant(v.ctx, q => q.query(`insert into wbs_nodes(org_id, project_id, kind, code, name) values ($1,$2,'zone','Z','z')`, [A.orgId, pa.projectId]))).rejects.toThrow(/row-level/);
  });
  it('support staff are read-only', async () => {
    const sup = { userId: A.userId, orgId: A.orgId, role: 'support' };
    expect(await withTenant(sup, q => count(q, 'projects'))).toBeGreaterThan(0);
    await expect(withTenant(sup, q => q.query(`insert into wbs_nodes(org_id, project_id, kind, code, name) values ($1,$2,'zone','ZS','z')`, [A.orgId, pa.projectId]))).rejects.toThrow(/row-level/);
  });
});

describe('external parties', () => {
  it('clients see only approved drawing revisions, never internal cost, never other tenants', async () => {
    const client = await makeUser(A.orgId, 'client', pa.projectId, { authorities: ['variation:approve'], limit: 10_000_000 });
    await withTenant(A.ctx, async q => {
      const d = (await q.query(`insert into drawings(org_id, project_id, number, title) values ($1,$2,'D-1','Plan') returning id`, [A.orgId, pa.projectId])).rows[0];
      await q.query(`insert into drawing_revisions(org_id, project_id, drawing_id, rev, status) values ($1,$2,$3,'A','superseded'),($1,$2,$3,'B','approved'),($1,$2,$3,'C','draft')`, [A.orgId, pa.projectId, d.id]);
    });
    const revs = await withTenant(client.ctx, async q => (await q.query('select rev from drawing_revisions order by rev')).rows.map(r => r.rev));
    expect(revs).toEqual(['B']);
    expect(await withTenant(client.ctx, q => count(q, 'boq_items'))).toBe(0);             // budget_rate_paise is internal
    expect(await withTenant(client.ctx, q => count(q, 'purchase_orders'))).toBe(0);
    expect(await withTenant(client.ctx, q => count(q, 'daily_reports'))).toBe(0);
    const boq = await withTenant(client.ctx, async q => (await q.query('select * from portal_boq($1)', [pa.projectId])).rows);
    expect(boq[0]).toMatchObject({ code: 'A1', rate_paise: '500000' });
    expect(Object.keys(boq[0])).not.toContain('budget_rate_paise');
    await expect(withTenant(client.ctx, q => q.query('select * from portal_boq($1)', [pb.projectId]))).rejects.toThrow(/not permitted/);
    await expect(withTenant(client.ctx, q => q.query(`update boq_items set rate_paise = 1`))).resolves.toMatchObject({ rowCount: 0 });
  });
  it('variation decisions need authority and a reason; limits are enforced', async () => {
    const lowAuth = await makeUser(A.orgId, 'client', pa.projectId, { authorities: [], limit: 0 });
    const ok = await makeUser(A.orgId, 'client', pa.projectId, { authorities: ['variation:approve'], limit: 1_000_000 });
    const v = await withTenant(A.ctx, async q => (await q.query(`insert into variations(org_id, project_id, number, title, scope, cost_delta_paise, status) values ($1,$2,'VO-1','Extra','scope', 2000000, 'submitted') returning id`, [A.orgId, pa.projectId])).rows[0].id);
    await expect(withTenant(lowAuth.ctx, q => q.query('select portal_decide_variation($1,true,$2)', [v, 'fine']))).rejects.toThrow(/authority/);
    await expect(withTenant(ok.ctx, q => q.query('select portal_decide_variation($1,true,$2)', [v, 'fine']))).rejects.toThrow(/limit/);
    await withTenant(A.ctx, q => q.query('update variations set cost_delta_paise = 500000 where id = $1', [v]));
    await expect(withTenant(ok.ctx, q => q.query('select portal_decide_variation($1,false,$2)', [v, '']))).rejects.toThrow(/reason/);
    await withTenant(ok.ctx, q => q.query('select portal_decide_variation($1,true,$2)', [v, 'Agreed on site']));
    const st = await withTenant(A.ctx, q => q.query('select status, decided_by from variations where id = $1', [v]));
    expect(st.rows[0]).toMatchObject({ status: 'approved', decided_by: ok.userId });
    await expect(withTenant(ok.ctx, q => q.query('select portal_decide_variation($1,true,$2)', [v, 'again']))).rejects.toThrow(/not awaiting/);
  });
  it('a subcontractor sees only their own work orders', async () => {
    const [s1, s2] = await withTenant(A.ctx, async q => (await q.query(`insert into parties(org_id, kind, name) values ($1,'subcontractor','Sub One'),($1,'subcontractor','Sub Two') returning id`, [A.orgId])).rows.map(r => r.id));
    await withTenant(A.ctx, q => q.query(`insert into work_orders(org_id, project_id, subcontractor_id, number) values ($1,$2,$3,'WO-1'),($1,$2,$4,'WO-2')`, [A.orgId, pa.projectId, s1, s2]));
    const c = await makeUser(A.orgId, 'contractor', pa.projectId, { partyId: s1 });
    const rows = await withTenant(c.ctx, async q => (await q.query('select number from work_orders')).rows.map(r => r.number));
    expect(rows).toEqual(['WO-1']);
  });
  it('RFIs: only the assigned party can respond', async () => {
    const [p1, p2] = await withTenant(A.ctx, async q => (await q.query(`insert into parties(org_id, kind, name) values ($1,'consultant','C1'),($1,'consultant','C2') returning id`, [A.orgId])).rows.map(r => r.id));
    const rfi = await withTenant(A.ctx, async q => (await q.query(`insert into rfis(org_id, project_id, number, location, question, decision_required, due_date, status, assigned_party_id) values ($1,$2,'RFI-1','L1','Q?','D', current_date + 3, 'open', $3) returning id`, [A.orgId, pa.projectId, p1])).rows[0].id);
    const wrong = await makeUser(A.orgId, 'contractor', pa.projectId, { partyId: p2 });
    await expect(withTenant(wrong.ctx, q => q.query('select portal_respond_rfi($1,$2)', [rfi, 'my answer']))).rejects.toThrow(/not found|not your/);
  });
});

describe('database-enforced invariants', () => {
  it('audit log and stock ledger are append-only', async () => {
    await expect(withTenant(A.ctx, q => q.query('update audit_log set action = $1', ['x']))).rejects.toThrow(/permission denied|append-only/);
    await expect(owner.query('delete from audit_log')).rejects.toThrow(/append-only/);
    await withTenant(A.ctx, q => q.query(`insert into stock_movements(org_id, project_id, site_id, item_code, unit, qty, kind) values ($1,$2,$3,'CEM','bag',10,'receipt')`, [A.orgId, pa.projectId, pa.siteId]));
    await expect(owner.query('update stock_movements set qty = 99')).rejects.toThrow(/append-only/);
  });
  it('financial changes write audit rows from triggers (field names only)', async () => {
    await withTenant(A.ctx, async q => {
      await q.query(`update boq_items set rate_paise = 510000 where id = $1`, [pa.boqId]);
      const r = await q.query(`select detail from audit_log where entity = 'boq_items' and entity_id = $1 order by id desc limit 1`, [pa.boqId]);
      expect(r.rows[0].detail.fields).toEqual(['rate_paise']);
    });
  });
  it('receipts cannot exceed the invoice and the database refuses overpayment under concurrency', async () => {
    const { billId } = await withTenant(A.ctx, async q => {
      const c = (await q.query(`insert into contracts(org_id, project_id, number, title) values ($1,$2,'C1','Main') returning id`, [A.orgId, pa.projectId])).rows[0];
      const b = (await q.query(`insert into ra_bills(org_id, project_id, contract_id, bill_no, period_to) values ($1,$2,$3,1,current_date) returning id`, [A.orgId, pa.projectId, c.id])).rows[0];
      return { billId: b.id };
    });
    const inv = await withTenant(A.ctx, async q => (await q.query(`insert into invoices(org_id, project_id, bill_id, number, amount_paise) values ($1,$2,$3,'INV-1',1000) returning id`, [A.orgId, pa.projectId, billId])).rows[0].id);
    const pay = (ref: string, amt: number) => withTenant(A.ctx, q => q.query(`insert into receipts(org_id, project_id, invoice_id, amount_paise, reference) values ($1,$2,$3,$4,$5)`, [A.orgId, pa.projectId, inv, amt, ref]));
    const res = await Promise.allSettled([pay('r1', 700), pay('r2', 700), pay('r3', 300)]);
    const okCount = res.filter(r => r.status === 'fulfilled').length;
    const total = await withTenant(A.ctx, async q => Number((await q.query('select sum(amount_paise) s from receipts where invoice_id = $1', [inv])).rows[0].s));
    expect(total).toBeLessThanOrEqual(1000);
    expect(okCount).toBeLessThan(3);
    await expect(pay('r1', 1)).rejects.toThrow();    // duplicate reference
  });
  it('closed projects are read-only', async () => {
    const p = await seedProject(A.ctx, 'ALPHA-CLOSED');
    await withTenant(A.ctx, q => q.query(`update projects set status = 'closed' where id = $1`, [p.projectId]));
    await expect(withTenant(A.ctx, q => q.query(`insert into rfis(org_id, project_id, number, location, question, decision_required, due_date) values ($1,$2,'R','l','q','d', current_date)`, [A.orgId, p.projectId]))).rejects.toThrow(/closed/);
  });
  it('one approved revision per drawing; same measured work cannot be entered twice', async () => {
    await expect(withTenant(A.ctx, async q => {
      const d = (await q.query(`select id from drawings where project_id = $1`, [pa.projectId])).rows[0];
      await q.query(`insert into drawing_revisions(org_id, project_id, drawing_id, rev, status) values ($1,$2,$3,'Z','approved')`, [A.orgId, pa.projectId, d.id]);
    })).rejects.toThrow(/one_approved_rev|duplicate/);
    await withTenant(A.ctx, q => q.query(`insert into measurement_book(org_id, project_id, boq_item_id, location, measured_on, qty) values ($1,$2,$3,'Grid A', '2026-01-01', 5)`, [A.orgId, pa.projectId, pa.boqId]));
    await expect(withTenant(A.ctx, q => q.query(`insert into measurement_book(org_id, project_id, boq_item_id, location, measured_on, qty) values ($1,$2,$3,'Grid A', '2026-01-01', 5)`, [A.orgId, pa.projectId, pa.boqId]))).rejects.toThrow(/duplicate|unique/);
  });
});
