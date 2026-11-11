// Creates ONE clearly-labelled demo business (tenants.is_demo = true) with sample data for sales demos and training.
// Never run against a customer database unless you intend to have a demo tenant there. Production data is untouched.
//   DATABASE_URL=<owner url> DEMO_PASSWORD='...' node scripts/seed-demo.mjs
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const { DATABASE_URL, DEMO_PASSWORD } = process.env;
if (!DATABASE_URL || !DEMO_PASSWORD || DEMO_PASSWORD.length < 10) { console.error("Set DATABASE_URL and DEMO_PASSWORD (10+ chars)"); process.exit(1); }
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("base64")}$${(await promisify(scrypt)(DEMO_PASSWORD, salt, 64)).toString("base64")}`;
const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect();
const t = randomUUID(), p = randomUUID();
await c.query("BEGIN");
try {
  const plan = (await c.query("SELECT id FROM plans WHERE code='growth' ORDER BY version DESC LIMIT 1")).rows[0].id;
  await c.query("INSERT INTO tenants(id,name,slug,status,plan_id,is_demo) VALUES ($1,'Demo Contractors (sample data)',$2,'active',$3,true)", [t, "demo-" + t.slice(0, 6), plan]);
  const users = {};
  for (const [k, name, role] of [["owner", "Demo Owner", "owner"], ["manager", "Demo Manager", "manager"], ["engineer", "Demo Engineer", "engineer"], ["client", "Demo Client", "client"]]) {
    const id = randomUUID(); users[k] = id;
    await c.query("INSERT INTO users(id,email,name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING", [id, `${k}@demo.example`, name, hash]);
    const real = (await c.query("SELECT id FROM users WHERE lower(email)=$1", [`${k}@demo.example`])).rows[0].id; users[k] = real;
    await c.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,$3)", [t, real, role]);
  }
  await c.query("INSERT INTO projects(id,tenant_id,code,name,client_name,location,status,created_by) VALUES ($1,$2,'DEMO-01','Sample Warehouse (demo)','Sample Client Pvt Ltd','Pune','active',$3)", [p, t, users.owner]);
  await c.query("INSERT INTO project_access(tenant_id,project_id,user_id) VALUES ($1,$2,$3)", [t, p, users.client]);
  const items = [["1.01", "Excavation in ordinary soil", "m3", 5000000, 18000], ["1.02", "PCC M10", "m3", 800000, 520000], ["1.03", "RCC M25 footing", "m3", 600000, 780000]];
  const ids = [];
  for (const [code, d, u, q, r] of items) ids.push((await c.query("INSERT INTO boq_items(tenant_id,project_id,code,description,unit,qty_milli,rate_minor,source) VALUES ($1,$2,$3,$4,$5,$6,$7,'demo seed') RETURNING id", [t, p, code, d, u, q, r])).rows[0].id);
  await c.query("INSERT INTO contracts(tenant_id,project_id,contract_no,status,advance_minor,approved_by,approved_at,snapshot) VALUES ($1,$2,'DEMO-CT-1','approved',50000000,$3,now(),'{}')", [t, p, users.owner]);
  for (const [i, q] of [[0, 1200000], [1, 150000]]) await c.query("INSERT INTO measurements(tenant_id,project_id,boq_item_id,qty_milli,measured_on,location,status,recorded_by,verified_by,verified_at) VALUES ($1,$2,$3,$4,current_date - 3,'Zone A','verified',$5,$6,now())", [t, p, ids[i], q, users.engineer, users.manager]);
  await c.query("COMMIT");
  console.log("Demo business created. Sign in as owner@/manager@/engineer@/client@demo.example with DEMO_PASSWORD.");
} catch (e) { await c.query("ROLLBACK"); console.error(e.message); process.exit(1); }
await c.end();
