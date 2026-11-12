// DEMONSTRATION DATA ONLY. Never run against production: refuses unless ALLOW_DEMO_DATA=true.
// Creates a workspace named "[DEMO] ..." with one user per role (password: Demo-pass-123), a contract, BOQ, site and activities.
import pg from 'pg';
import crypto from 'node:crypto';
if (process.env.ALLOW_DEMO_DATA !== 'true') { console.error('Set ALLOW_DEMO_DATA=true to load demo data (never in production).'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER }); await db.connect();
const hash = pw => { const salt = crypto.randomBytes(16); const k = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }); return `scrypt$16384$8$1$${salt.toString('base64')}$${k.toString('base64')}`; };
const PW = 'Demo-pass-123';
const ex = await db.query(`select id from orgs where slug = 'demo-constructions'`);
if (ex.rowCount) { console.log('Demo workspace already exists.'); process.exit(0); }
const q = async (s, p) => (await db.query(s, p)).rows;
const plan = (await q(`select id from plans where code='growth' order by version desc limit 1`))[0];
const org = (await q(`insert into orgs(name, slug, status, legal_name, gstin, address, billing_email, billing_address, setup, sample_data) values ('[DEMO] Demo Constructions','demo-constructions','active','Demo Constructions Pvt Ltd','27ABCDE1234F1Z5','1 Demo Street, Pune','accounts@demo.test','1 Demo Street, Pune','{"activated":true}',true) returning id`))[0].id;
await q(`insert into subscriptions(org_id, plan_id, status, interval, current_period_start, current_period_end) values ($1,$2,'active','month', now(), now() + interval '30 days')`, [org, plan.id]);
const users = {};
for (const [role, name] of [['owner', 'Olivia Owner'], ['manager', 'Manoj Manager'], ['engineer', 'Esha Engineer'], ['qs', 'Quinn QS'], ['store', 'Sam Store'], ['supervisor', 'Sunil Supervisor'], ['client', 'Chitra Client'], ['consultant', 'Kabir Consultant']]) {
  const email = `${role}@demo.test`; const u = (await q(`insert into users(email, name, password_hash, email_verified_at) values ($1,$2,$3,now()) returning id`, [email, name, hash(PW)]))[0]; users[role] = u.id;
  await q(`insert into memberships(org_id, user_id, role) values ($1,$2,$3)`, [org, u.id, role]);
}
const parties = await q(`insert into parties(org_id, kind, name, gstin) values ($1,'client','Skyline Developers','27AAAAA0000A1Z5'),($1,'supplier','Apex Cement Traders',null),($1,'subcontractor','Rapid Civil Works',null) returning id, kind`, [org]);
const proj = (await q(`insert into projects(org_id, code, name, status, location, client_party_id, owner_user_id) values ($1,'DEMO-1','[DEMO] Skyline Tower A','active','Pune',$2,$3) returning id`, [org, parties[0].id, users.owner]))[0].id;
for (const r of ['owner', 'manager', 'engineer', 'qs', 'store', 'supervisor']) await q(`insert into project_members(org_id, project_id, user_id, project_role, approval_limit_paise, authorities) values ($1,$2,$3,$4,$5,$6)`, [org, proj, users[r], r, r === 'manager' || r === 'owner' ? '9223372036854775807' : '0', r === 'owner' || r === 'manager' ? ['po:approve'] : []]);
for (const r of ['client', 'consultant']) await q(`insert into project_members(org_id, project_id, user_id, project_role, approval_limit_paise, authorities) values ($1,$2,$3,$4,'50000000',$5)`, [org, proj, users[r], r, ['bill:certify', 'variation:approve']]);
await q(`insert into wbs_nodes(org_id, project_id, kind, code, name) values ($1,$2,'site','S1','Main block'),($1,$2,'site','S2','Annex')`, [org, proj]);
const boq = await q(`insert into boq_items(org_id, project_id, code, description, unit, qty, rate_paise, budget_rate_paise) values ($1,$2,'A1','Excavation in soil','m3',1000,50000,40000),($1,$2,'B1','Concrete M25','m3',400,550000,500000) returning id, code`, [org, proj]);
const c = (await q(`insert into contracts(org_id, project_id, number, title, status, value_paise, advance_bp, advance_recovery_bp, retention_bp, payment_days, approved_at, approved_by) values ($1,$2,'DEMO-C1','Main contract','active',270000000,1000,1000,500,30,now(),$3) returning id`, [org, proj, users.owner]))[0].id;
await q(`insert into activities(org_id, project_id, code, name, start_date, finish_date, planned_qty, boq_item_id) values ($1,$2,'ACT-1','Excavation','2026-12-01','2026-12-20',1000,$3),($1,$2,'ACT-2','Foundation concrete','2026-12-21','2027-01-20',400,$4)`, [org, proj, boq[0].id, boq[1].id]);
console.log('Demo data loaded. Sign in as owner@demo.test / manager@demo.test / engineer@demo.test / qs@demo.test / store@demo.test / supervisor@demo.test / client@demo.test / consultant@demo.test — password', PW);
await db.end();
