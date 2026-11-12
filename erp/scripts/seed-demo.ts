// DEMO DATA ONLY. Refuses to run unless ENABLE_DEMO_DATA=true. Creates "Demo Traders" with sample users, masters and stock.
import { withSystem, withTenantSystem, pool } from "../lib/db";
import { provisionTenant } from "../lib/tenancy";
import { startTrial } from "../lib/billing";
import { hashPassword } from "../lib/auth/password";
import { openingStock } from "../lib/erp/stock";
import { SYSTEM_ROLES } from "../lib/perms";

if (process.env.ENABLE_DEMO_DATA !== "true") { console.error("Refusing to seed: set ENABLE_DEMO_DATA=true (never in production)."); process.exit(1); }
const PW = "DemoPass#2026";
const hash = await hashPassword(PW);
const tenantId = await withSystem(async (db) => {
  if ((await db.query("select 1 from tenants where slug='demo-traders'")).rowCount) { console.log("Demo company already exists."); return null; }
  const mk = async (email: string, name: string) => (await db.query("insert into users(email,name,password_hash,email_verified_at) values ($1,$2,$3,now()) on conflict ((lower(email))) do update set name=excluded.name returning id", [email, name, hash])).rows[0].id as string;
  const owner = await mk("owner@demo.test", "Asha Owner");
  const t = (await db.query("insert into tenants(name,slug,legal_name,gstin,address) values ('Demo Traders','demo-traders','Demo Traders Pvt Ltd','27ABCDE1234F1Z5','12 Market Road, Pune') returning id")).rows[0].id as string;
  await db.query("select set_config('app.tenant_id',$1,true)", [t]);
  await provisionTenant(db, t, owner, "Pune HQ"); await startTrial(db, t);
  for (const [email, name, role] of [["manager@demo.test", "Manoj Manager", "manager"], ["sales@demo.test", "Sana Sales", "sales"], ["warehouse@demo.test", "Wasim Warehouse", "warehouse"], ["accounts@demo.test", "Anita Accounts", "accountant"], ["purchase@demo.test", "Pooja Purchase", "purchaser"]] as const) {
    const u = await mk(email, name); const r = (await db.query("select id from roles where tenant_id=$1 and key=$2", [t, role])).rows[0].id;
    await db.query("insert into memberships(tenant_id,user_id,role_id) values ($1,$2,$3) on conflict do nothing", [t, u, r]);
  }
  return t;
});
if (tenantId) {
  await withTenantSystem(tenantId, async (db) => {
    const tax = (await db.query("select id from tax_codes where tenant_id=$1 and code='GST18'", [tenantId])).rows[0].id;
    const wh = (await db.query("select id from warehouses where tenant_id=$1", [tenantId])).rows[0].id;
    const owner = (await db.query("select id from users where email='owner@demo.test'")).rows[0].id;
    const items: [string, string, number, number, number][] = [["PEN-01", "Ball pen (box of 10)", 12000, 8000, 200], ["NBK-A5", "Notebook A5", 6500, 4000, 500], ["PAP-A4", "A4 paper ream", 38000, 30000, 100], ["STP-01", "Stapler", 15000, 9000, 40]];
    for (const [sku, name, sale, buy, qty] of items) {
      const id = (await db.query("insert into items(tenant_id,sku,name,sale_price_paise,purchase_price_paise,tax_code_id,reorder_level_qty,reorder_qty) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id", [tenantId, sku, name, sale, buy, tax, 20000, 100000])).rows[0].id;
      const ctx: any = { tenant: { id: tenantId }, user: { id: owner } };
      await openingStock(db, ctx, { itemId: id, warehouseId: wh, qty: qty * 1000, unitCost: buy });
    }
    await db.query("insert into customers(tenant_id,code,name,email,credit_limit_paise) values ($1,'ACME','Acme Stationers','buy@acme.test',5000000), ($1,'BETA','Beta Schools','accounts@beta.test',2000000)", [tenantId]);
    await db.query("insert into suppliers(tenant_id,code,name,email) values ($1,'WRT','Writewell Industries','sales@writewell.test'), ($1,'PPR','Paper Mills Ltd','orders@papermills.test')", [tenantId]);
  });
  console.log("Seeded Demo Traders. Users (password " + PW + "): owner@, manager@, sales@, warehouse@, accounts@, purchase@demo.test");
}
void SYSTEM_ROLES; await pool.end();
