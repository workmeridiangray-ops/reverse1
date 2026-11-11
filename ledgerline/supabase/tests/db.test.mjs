// Row-level security + invariant tests against a real Postgres. Run: npm run test:db  (needs PGURL, see README)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url); const { Client } = require('pg');
const ADMIN = process.env.PGURL ?? 'postgres://postgres@localhost:54399/postgres?host=/tmp';
const DB = 'll_test_' + Date.now(); let admin; const U = {};
const sql = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

before(async () => {
  admin = new Client({ connectionString: ADMIN }); await admin.connect(); await admin.query(`create database ${DB}`);
  const a = new Client({ connectionString: ADMIN.replace(/\/postgres(\?|$)/, `/${DB}$1`) }); await a.connect(); admin._db = a;
  await a.query(sql('./supabase_prelude.sql'));
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) await a.query(sql('../migrations/' + f));
  for (const n of ['ownerA', 'managerA', 'staffA', 'ownerB', 'cust1', 'cust2', 'plat', 'support', 'stranger']) { U[n] = randomUUID(); await a.query('insert into auth.users(id,email) values ($1,$2)', [U[n], n + '@x.test']); }
  await a.query(`insert into tenants values ('tA','Alpha'),('tB','Beta')`);
  const m = (id, t, u, email, role, st = 'active') => a.query('insert into members(id,tenant_id,user_id,email,name,role,status) values ($1,$2,$3,$4,$4,$5,$6)', [id, t, u, email, role, st]);
  await m('mA1', 'tA', U.ownerA, 'ownerA@x.test', 'owner'); await m('mA2', 'tA', U.managerA, 'managerA@x.test', 'manager'); await m('mA3', 'tA', U.staffA, 'staffA@x.test', 'staff'); await m('mB1', 'tB', U.ownerB, 'ownerB@x.test', 'owner');
  await a.query(`insert into portal_users values ('tA','c1','cust1@x.test',$1,true),('tA','c2','cust2@x.test',$2,true)`, [U.cust1, U.cust2]);
  await a.query(`insert into platform_staff values ($1,'plat@x.test','Plat','platform_owner',true),($2,'support@x.test','Sup','platform_support',true)`, [U.plat, U.support]);
  const r = (t, c, id, d) => a.query('insert into records(tenant_id,collection,id,data) values ($1,$2,$3,$4)', [t, c, id, JSON.stringify(d)]);
  await r('tA', 'invoices', 'i1', { number: 'INV-1', customerId: 'c1', status: 'issued', total: 100000, lines: [{ desc: 'x' }], issueDate: '2026-06-01', totals: { total: 100000 } });
  await r('tA', 'invoices', 'i2', { number: 'INV-2', customerId: 'c2', status: 'issued', total: 50000, lines: [], issueDate: '2026-06-02', totals: {} });
  await r('tA', 'invoices', 'd1', { number: '', customerId: 'c1', status: 'draft', total: 1, lines: [], issueDate: '2026-06-03', totals: {} });
  await r('tA', 'receipts', 'r1', { number: 'RCT-1', customerId: 'c1', amount: 120000, date: '2026-06-05', ref: 'UTR1', status: 'unapplied' });
  await r('tA', 'receipts', 'r2', { number: 'RCT-2', customerId: 'c2', amount: 10000, date: '2026-06-05', ref: 'UTR2', status: 'unapplied' });
  await r('tA', 'bankTx', 'b1', { amount: 1, status: 'unmatched' }); await r('tA', 'bills', 'bl1', { supplierId: 's1', ref: 'B-1', amount: 5 });
  await r('tA', 'periods', 'p1', { start: '2026-01-01', end: '2026-03-31', locked: true }); await r('tA', 'numbering', 'n1', { nextSeq: 10 });
  await r('tA', 'credits', 'cr1', { number: 'CN-1', invoiceId: 'i1', customerId: 'c1', amount: 100, reason: 'x', status: 'pending', requestedBy: 'Alice', date: '2026-06-06' });
  await r('tA', 'audit', 'au1', { action: 'seed' }); await r('tA', 'customers', 'c1', { name: 'Cust One' }); await r('tA', 'customers', 'c2', { name: 'Cust Two' });
  await r('tB', 'invoices', 'ib1', { number: 'INV-B1', customerId: 'x', status: 'issued', total: 5, lines: [], issueDate: '2026-06-01', totals: {} });
});
after(async () => { await admin._db.end(); await admin.query(`drop database ${DB} with (force)`); await admin.end(); });

/** Run as a given user (or anon) inside a transaction that always rolls back. */
async function as(who, fn) {
  const c = new Client({ connectionString: ADMIN.replace(/\/postgres(\?|$)/, `/${DB}$1`) }); await c.connect();
  try { await c.query('begin'); await c.query(`set local role ${who ? 'authenticated' : 'anon'}`); if (who) await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U[who], email: who + '@x.test' })]); let n = 0; return await fn(async (q, p) => { const sp = 'sp' + n++; await c.query('savepoint ' + sp); try { const r = await c.query(q, p); await c.query('release ' + sp); return r; } catch (e) { await c.query('rollback to savepoint ' + sp); throw e; } }); }
  finally { await c.query('rollback').catch(() => {}); await c.end(); }
}
const fails = async (p, re) => { await assert.rejects(p, (e) => (re ? re.test(e.message) : true)); };
const count = async (who, where = 'true') => as(who, async (q) => (await q(`select count(*)::int n from records where ${where}`)).rows[0].n);

test('anonymous users see nothing and can write nothing', async () => {
  await as(null, async (q) => { await fails(q('select * from records')); });
});
test('tenants are isolated from each other', async () => {
  assert.equal(await count('ownerB', `tenant_id='tA'`), 0);
  assert.ok(await count('ownerA', `tenant_id='tA'`) > 5);
  assert.equal(await count('ownerA', `tenant_id='tB'`), 0);
  await as('ownerB', async (q) => { await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','customers','x','{}')`), /row-level security/); });
  await as('ownerB', async (q) => { const r = await q(`update records set data='{"name":"hacked"}' where tenant_id='tA' and id='c1'`); assert.equal(r.rowCount, 0); });
  await as('ownerB', async (q) => { const r = await q(`delete from records where tenant_id='tA'`); assert.equal(r.rowCount, 0); });
  await as('stranger', async (q) => { assert.equal((await q('select count(*)::int n from records')).rows[0].n, 0); assert.equal((await q('select count(*)::int n from members')).rows[0].n, 0); });
});
test('staff cannot read restricted collections or write settings-type collections', async () => {
  assert.equal(await count('staffA', `collection in ('bankTx','bills')`), 0);
  assert.equal(await count('managerA', `collection in ('bankTx','bills')`), 2);
  await as('staffA', async (q) => {
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','periods','px','{"start":"2026-07-01","end":"2026-07-31","locked":true}')`), /row-level security/);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','bills','bx','{"supplierId":"s9","ref":"Z"}')`), /row-level security/);
    const ok = await q(`insert into records(tenant_id,collection,id,data) values ('tA','invoices','dnew','{"status":"draft","number":"","total":1,"lines":[],"issueDate":"2026-06-10","totals":{},"customerId":"c1"}')`); assert.equal(ok.rowCount, 1);
    await fails(q(`delete from records where tenant_id='tA' and collection='receipts'`).then((r) => { if (r.rowCount === 0) throw new Error('blocked'); }));
  });
});
test('customers see only their own organisation and never drafts', async () => {
  await as('cust1', async (q) => {
    const inv = (await q(`select id from records where collection='invoices' order by id`)).rows.map((r) => r.id); assert.deepEqual(inv, ['i1']);
    assert.deepEqual((await q(`select id from records where collection='receipts'`)).rows.map((r) => r.id), ['r1']);
    assert.equal((await q(`select count(*)::int n from records where collection in ('bankTx','bills','audit','periods')`)).rows[0].n, 0);
    assert.deepEqual((await q(`select id from records where collection='customers'`)).rows.map((r) => r.id), ['c1']);
    const msg = await q(`insert into records(tenant_id,collection,id,data) values ('tA','messages','m1','{"customerId":"c1","text":"hi"}')`); assert.equal(msg.rowCount, 1);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','messages','m2','{"customerId":"c2","text":"spoof"}')`), /row-level security/);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','receipts','rx','{"customerId":"c1","amount":1}')`), /row-level security/);
    const upd = await q(`update records set data = jsonb_set(data,'{total}','1') where collection='invoices'`); assert.equal(upd.rowCount, 0);
  });
});
test('issued invoices are frozen; void is allowed; drafts can be deleted, issued cannot', async () => {
  await as('managerA', async (q) => {
    await fails(q(`update records set data = jsonb_set(data,'{total}','1') where collection='invoices' and id='i1'`), /cannot be edited/);
    await fails(q(`update records set data = jsonb_set(data,'{lines}','[]') where collection='invoices' and id='i1'`), /cannot be edited/);
    await fails(q(`delete from records where collection='invoices' and id='i1'`), /only draft/);
    await fails(q(`update records set data = jsonb_set(data,'{status}','"draft"') where collection='invoices' and id='i1'`), /only move to void/);
    const dd = await q(`update records set data = jsonb_set(data,'{delivery}','"delivered"') where collection='invoices' and id='i1'`); assert.equal(dd.rowCount, 1);
    const v = await q(`update records set data = jsonb_set(data,'{status}','"void"') where collection='invoices' and id='i1'`); assert.equal(v.rowCount, 1);
    await fails(q(`update records set data = jsonb_set(data,'{status}','"issued"') where collection='invoices' and id='i1'`), /cannot be reopened|only move/);
    assert.equal((await q(`delete from records where collection='invoices' and id='d1'`)).rowCount, 1);
  });
});
test('an invoice with no status field cannot dodge the issue rules', async () => {
  await as('managerA', async (q) => {
    await q(`insert into records(tenant_id,collection,id,data) values ('tA','invoices','ns','{"number":"","total":1,"lines":[],"totals":{},"customerId":"c1","issueDate":"2026-06-10"}')`);
    await fails(q(`update records set data = data || '{"status":"issued"}' where id='ns'`), /must have a number/);
    await q(`update records set data = data || '{"status":"issued","number":"INV-NS"}' where id='ns'`);
    await fails(q(`update records set data = jsonb_set(data,'{total}','9') where id='ns'`), /cannot be edited/);
  });
});
test('allocations cannot over-apply a receipt or invoice, or cross customers', async () => {
  const ins = (q, id, rc, inv, amt) => q(`insert into records(tenant_id,collection,id,data) values ('tA','allocations',$1,$2)`, [id, JSON.stringify({ receiptId: rc, invoiceId: inv, amount: amt, reversed: false })]);
  await as('managerA', async (q) => {
    await ins(q, 'a1', 'r1', 'i1', 60000);
    await fails(ins(q, 'a2', 'r1', 'i1', 50000), /exceeds the invoice total/);
    await fails(ins(q, 'a3', 'r2', 'i1', 5000), /different customers/);
    await fails(ins(q, 'a4', 'r2', 'i2', 20000), /exceeds the receipt amount/);
    await fails(ins(q, 'a5', 'r1', 'i1', 0), /positive|exceed/);
    await fails(ins(q, 'a6', 'nope', 'i1', 1), /unknown receipt/);
    await ins(q, 'a7', 'r1', 'i1', 40000);
    await fails(q(`delete from records where collection='allocations' and id='a7'`), /never deleted/);
    await q(`update records set data = jsonb_set(data,'{reversed}','true') where collection='allocations' and id='a7'`);
    await ins(q, 'a8', 'r1', 'i1', 40000);
  });
});
test('locked periods refuse backdated receipts, adjustments and issuing', async () => {
  await as('managerA', async (q) => {
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','receipts','rl','{"number":"R9","customerId":"c1","amount":5,"date":"2026-02-10","ref":"L1"}')`), /locked period/);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','credits','cl','{"number":"CN9","invoiceId":"i1","amount":5,"reason":"x","date":"2026-02-10","status":"pending","requestedBy":"a"}')`), /locked period/);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','invoices','il','{"number":"INV-LOCK","status":"issued","issueDate":"2026-03-15","total":1,"lines":[],"totals":{},"customerId":"c1"}')`), /locked period/);
    await q(`insert into records(tenant_id,collection,id,data) values ('tA','receipts','ro','{"number":"R10","customerId":"c1","amount":5,"date":"2026-06-10","ref":"OK1"}')`);
  });
});
test('duplicate numbers, receipt references, provider events and vendor bills are rejected', async () => {
  await as('managerA', async (q) => {
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','invoices','dup','{"number":"INV-1","status":"issued","issueDate":"2026-06-01","total":1,"lines":[],"totals":{},"customerId":"c1"}')`), /uq_doc_number|duplicate/);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','receipts','rdup','{"number":"R77","customerId":"c1","amount":5,"date":"2026-06-10","ref":"UTR1"}')`), /uq_receipt_ref|duplicate/);
    await q(`insert into records(tenant_id,collection,id,data) values ('tA','receipts','e1','{"number":"R78","customerId":"c1","amount":5,"date":"2026-06-10","ref":"E-1","providerEventId":"evt_1"}')`);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','receipts','e2','{"number":"R79","customerId":"c1","amount":5,"date":"2026-06-10","ref":"E-2","providerEventId":"evt_1"}')`), /uq_receipt_event|duplicate/);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','bills','bdup','{"supplierId":"s1","ref":" b-1 ","amount":9}')`), /uq_bill_ref|duplicate/);
  });
  // the same number in another business is fine
  await as('ownerB', async (q) => { await q(`insert into records(tenant_id,collection,id,data) values ('tB','invoices','ok','{"number":"INV-1","status":"issued","issueDate":"2026-06-01","total":1,"lines":[],"totals":{},"customerId":"x"}')`); });
});
test('requesters cannot approve their own adjustment; audit is append-only; numbering never goes backwards', async () => {
  await as('managerA', async (q) => {
    await fails(q(`update records set data = data || '{"status":"approved","approvedBy":"Alice"}' where id='cr1'`), /requester/);
    await fails(q(`update records set data = data || '{"status":"approved"}' where id='cr1'`), /requester/);
    assert.equal((await q(`update records set data = data || '{"status":"approved","approvedBy":"Bob"}' where id='cr1'`)).rowCount, 1);
    await fails(q(`update records set data = '{"action":"edited"}' where collection='audit'`), /append-only|cannot be changed/);
    await fails(q(`delete from records where collection='audit'`), /cannot be changed|deleted/);
    await fails(q(`update records set data = jsonb_set(data,'{nextSeq}','3') where collection='numbering'`), /backwards/);
    assert.equal((await q(`update records set data = jsonb_set(data,'{nextSeq}','11') where collection='numbering'`)).rowCount, 1);
    await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','credits','cz','{"number":"CNZ","invoiceId":"i1","amount":5,"reason":"","date":"2026-06-10","status":"pending","requestedBy":"a"}')`), /needs a reason/);
  });
});
test('only owners manage members; a business always keeps an owner; roles cannot be self-escalated', async () => {
  await as('staffA', async (q) => {
    const r = await q(`update members set role='owner' where user_id=$1`, [U.staffA]); assert.equal(r.rowCount, 0);
    await fails(q(`insert into members(id,tenant_id,email,name,role,status) values ('mx','tA','e@x.test','E','owner','active')`), /row-level security/);
  });
  await as('managerA', async (q) => { assert.equal((await q(`update members set role='owner' where user_id=$1`, [U.managerA])).rowCount, 0); });
  await as('ownerA', async (q) => { await fails(q(`update members set status='suspended' where id='mA1'`), /at least one active owner/); assert.equal((await q(`update members set status='suspended', suspend_reason='left' where id='mA3'`)).rowCount, 1); });
  await as('staffA', async (q) => { assert.equal((await q('select count(*)::int n from records')).rows[0].n > 0, true); });
});
test('suspended members and revoked portal users lose access immediately', async () => {
  await admin._db.query(`update members set status='suspended' where id='mA3'`);
  assert.equal(await count('staffA'), 0);
  await admin._db.query(`update members set status='active' where id='mA3'`);
  await admin._db.query(`update portal_users set active=false where customer_id='c1'`);
  assert.equal(await count('cust1'), 0);
  await admin._db.query(`update portal_users set active=true where customer_id='c1'`);
});
test('customers can read the public profile but not private settings; support access goes through a controlled request', async () => {
  await admin._db.query(`insert into records(tenant_id,collection,id,data) values ('tA','_public','main','{"business":{"legalName":"Alpha"}}'),('tA','_settings','main','{"service":{"invoiceApprovalValue":1}}')`);
  await as('cust1', async (q) => { assert.deepEqual((await q(`select id from records where collection in ('_public','_settings') order by 1`)).rows.map((r) => r.id), ['main']); assert.equal((await q(`select 1 from records where collection='_settings'`)).rowCount, 0); });
  await as('staffA', async (q) => { assert.equal((await q(`select 1 from records where collection='_settings'`)).rowCount, 1); });
  await as('support', async (q) => { await fails(q(`insert into records(tenant_id,collection,id,data) values ('tA','supportAccess','x','{}')`), /row-level security/); const id = (await q(`select request_support_access('tA','Investigate import','Imports only','2026-12-31') id`)).rows[0].id; assert.ok(id.startsWith('sa_')); await fails(q(`select request_support_access('tA','  ','x','2026-12-31')`), /reason/); await fails(q(`select request_support_access('nope','why','x','2026-12-31')`), /unknown business/); });
  await as('ownerA', async (q) => { assert.equal((await q(`select request_support_access('tA','x','y','2026-12-31')`).catch((e) => e)).message?.includes('only support staff'), true); });
});
test('platform data is invisible to tenants and scoped by platform role', async () => {
  await admin._db.query(`insert into platform_records values ('biz','b1','{"name":"X"}'),('tickets','t1','{"s":"x"}'),('plans','p1','{"n":"Growth"}')`);
  await as('ownerA', async (q) => { assert.deepEqual((await q('select collection from platform_records order by 1')).rows.map((r) => r.collection), ['plans']); await fails(q(`insert into platform_records values ('coupons','c','{}')`), /row-level security/); });
  await as('support', async (q) => { assert.equal((await q('select count(*)::int n from platform_records')).rows[0].n, 3); assert.equal((await q(`update platform_records set data='{"s":"y"}' where collection='tickets'`)).rowCount, 1); await fails(q(`insert into platform_records values ('coupons','c','{}')`), /row-level security/); });
  await as('plat', async (q) => { await q(`insert into platform_records values ('coupons','c','{}')`); });
  await as('ownerA', async (q) => { assert.equal((await q('select count(*)::int n from platform_staff')).rows[0].n, 0); });
});
test('signup creates a business with the caller as owner; invitations are claimed by email', async () => {
  const nu = randomUUID(); await admin._db.query('insert into auth.users(id,email) values ($1,$2)', [nu, 'newbie@x.test']);
  const c = new Client({ connectionString: ADMIN.replace(/\/postgres(\?|$)/, `/${DB}$1`) }); await c.connect();
  try {
    await c.query('begin'); await c.query('set local role authenticated'); await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: nu, email: 'newbie@x.test' })]);
    const t = (await c.query(`select create_tenant('Gamma Ltd','New Owner') t`)).rows[0].t;
    assert.equal((await c.query('select role from members where tenant_id=$1', [t])).rows[0].role, 'owner');
    assert.equal((await c.query(`select count(*)::int n from records where tenant_id=$1`, [t])).rows[0].n, 4);
    await assert.rejects(c.query(`select create_tenant('  ','x')`), /required/);
    await c.query('rollback');
  } finally { await c.end(); }
  await admin._db.query(`insert into members(id,tenant_id,email,name,role,status) values ('mInv','tA','newbie@x.test','Newbie','staff','invited')`);
  await as(null, async (q) => { await fails(q('select claim_access()')); });
  const c2 = new Client({ connectionString: ADMIN.replace(/\/postgres(\?|$)/, `/${DB}$1`) }); await c2.connect();
  try { await c2.query('begin'); await c2.query('set local role authenticated'); await c2.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: nu, email: 'newbie@x.test' })]);
    assert.equal((await c2.query('select claim_access() r')).rows[0].r.members, 1); assert.ok((await c2.query(`select count(*)::int n from records where tenant_id='tA'`)).rows[0].n > 0); await c2.query('rollback'); } finally { await c2.end(); }
});

test('the generated demo seed loads and respects isolation', async () => {
  const dbn = DB + '_seed'; await admin.query(`create database ${dbn}`);
  const url = ADMIN.replace(/\/postgres(\?|$)/, `/${dbn}$1`); const a = new Client({ connectionString: url }); await a.connect();
  try {
    await a.query(sql('./supabase_prelude.sql'));
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) await a.query(sql('../migrations/' + f));
    const seed = sql('./seed.data.sql'); const ids = [...new Set([...seed.matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12})'/g)].map((m) => m[1]))];
    for (const id of ids) await a.query('insert into auth.users(id,email) values ($1,$2) on conflict do nothing', [id, id]);
    await a.query(seed);
    const n = async (t) => Number((await a.query(`select count(*) from ${t}`)).rows[0].count);
    assert.ok(await n('records') > 700); assert.equal(await n('tenants'), 2); assert.ok(await n('platform_records') > 50); assert.equal(await n('platform_staff'), 4);
    const asUser = async (uid, email, sqlText) => { await a.query('begin'); await a.query('set local role authenticated'); await a.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid, email })]); const r = await a.query(sqlText); await a.query('rollback'); return r.rows; };
    const owner = (await a.query(`select user_id from members where email='owner@northwind.test' and tenant_id='t1'`)).rows[0].user_id; assert.ok(owner);
    const o = await asUser(owner, 'owner@northwind.test', `select tenant_id, count(*)::int n from records group by 1 order by 1`);
    assert.deepEqual(o.map((r) => r.tenant_id), ['t1', 't2']);
    const ko = (await a.query(`select user_id from members where email='owner@kestrel.test'`)).rows[0].user_id;
    assert.deepEqual((await asUser(ko, 'owner@kestrel.test', `select distinct tenant_id from records`)).map((r) => r.tenant_id), ['t2']);
    const cust = (await a.query(`select user_id from portal_users where email='accounts@aarav.example'`)).rows[0].user_id;
    const c = await asUser(cust, 'accounts@aarav.example', `select distinct data->>'customerId' cid from records where collection='invoices'`);
    assert.deepEqual(c.map((r) => r.cid), ['cu_t1_0']);
    const staff = (await a.query(`select user_id from members where email='staff@northwind.test'`)).rows[0].user_id;
    assert.equal((await asUser(staff, 'staff@northwind.test', `select 1 from records where collection in ('bankTx','bills','apiKeys')`)).length, 0);
  } finally { await a.end(); await admin.query(`drop database ${dbn} with (force)`); }
});
