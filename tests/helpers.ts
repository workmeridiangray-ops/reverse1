import pg from "pg";
import { tx, plat } from "@/lib/server/db";
import type { Ctx } from "@/lib/server/svc/ctx";
import type { Role } from "@/lib/server/perms";

export const ownerUrl = "postgres://mfg_owner:owner@localhost/mfg_test";
export type World = { companyId: string; userId: string; plantId: string; stockLoc: string; qLoc: string; wc: string; customerId: string; supplierId: string; items: Record<string, string>; ctx: (role?: Role, userId?: string) => Ctx; user2: string };

export async function mkUser(email: string) {
  const r = await plat("insert into users(email,name,password_hash,email_verified_at) values ($1,$1,'x',now()) returning id", [email]); return r.rows[0].id as string;
}
/** A realistic small factory: pump = housing + bolts; housing = castings. Built with the owner role (bypasses RLS) like a seed script. */
export async function seedCompany(slug: string): Promise<World> {
  const o = new pg.Client({ connectionString: ownerUrl }); await o.connect();
  const q = async (sql: string, p: unknown[] = []) => (await o.query(sql, p)).rows;
  const co = (await q("insert into companies(name,slug,status) values ($1,$1,'active') returning id", [slug]))[0].id;
  const userId = await mkUser(`${slug}-owner@t.test`); const user2 = await mkUser(`${slug}-second@t.test`);
  await q("insert into memberships(company_id,user_id,role) values ($1,$2,'owner'),($1,$3,'manager')", [co, userId, user2]);
  const plant = (await q("insert into plants(company_id,code,name) values ($1,'P1','Pune') returning id", [co]))[0].id;
  const stockLoc = (await q("insert into locations(company_id,plant_id,code,name,kind) values ($1,$2,'STK-A','Stores','stock') returning id", [co, plant]))[0].id;
  const qLoc = (await q("insert into locations(company_id,plant_id,code,name,kind) values ($1,$2,'QRN','Quarantine','quarantine') returning id", [co, plant]))[0].id;
  await q("insert into uoms(company_id,code,name) values ($1,'EA','Each'),($1,'KG','Kilogram')", [co]);
  for (let d = 1; d <= 5; d++) await q("insert into shift_calendar(company_id,plant_id,weekday) values ($1,$2,$3)", [co, plant, d]);
  const wc = (await q("insert into work_centres(company_id,plant_id,code,name,cost_rate_per_hour_paise,overhead_pct) values ($1,$2,'WC1','Machining',30000,50) returning id", [co, plant]))[0].id;
  const mk = async (code: string, kind: string, extra: Record<string, unknown> = {}) => (await q(
    "insert into items(company_id,code,name,kind,uom,tracking,lot_size,lead_time_days,std_cost_paise) values ($1,$2,$2,$3,'EA',$4,$5,$6,$7) returning id",
    [co, code, kind, extra.tracking ?? "none", extra.lot ?? 1, extra.lt ?? 2, extra.std ?? 0]))[0].id;
  const items = { PUMP: await mk("PUMP", "make", { tracking: "batch", lt: 3, std: 20000 }), HOUSING: await mk("HOUSING", "make", { lt: 2, std: 8000 }),
    BOLT: await mk("BOLT", "buy", { lot: 100, lt: 5, std: 100 }), CASTING: await mk("CASTING", "buy", { tracking: "batch", lot: 10, lt: 10, std: 3000 }), ALT: await mk("BOLT-ALT", "buy", { std: 120 }) } as Record<string, string>;
  const bom = async (item: string, lines: [string, number, number][], yieldPct = 100) => {
    const b = (await q("insert into boms(company_id,item_id,version,yield_pct) values ($1,$2,1,$3) returning id", [co, item, yieldPct]))[0].id;
    for (const [comp, qty, scrap] of lines) await q("insert into bom_lines(company_id,bom_id,component_item_id,qty_per,scrap_pct,substitute_item_id) values ($1,$2,$3,$4,$5,$6)", [co, b, comp, qty, scrap, comp === items.BOLT ? items.ALT : null]);
    await q("update boms set status='released' where id=$1", [b]); return b;
  };
  await bom(items.PUMP!, [[items.HOUSING!, 1, 0], [items.BOLT!, 4, 0]]); await bom(items.HOUSING!, [[items.CASTING!, 2, 0]]);
  for (const it of [items.PUMP!, items.HOUSING!]) {
    const r = (await q("insert into routings(company_id,item_id,version,status) values ($1,$2,1,'released') returning id", [co, it]))[0].id;
    await q("insert into routing_ops(company_id,routing_id,seq,name,work_centre_id,setup_min,run_min_per_unit) values ($1,$2,10,'Machine',$3,30,12)", [co, r, wc]);
  }
  const customerId = (await q("insert into customers(company_id,code,name) values ($1,'C1','Acme Pumps Ltd') returning id", [co]))[0].id;
  const supplierId = (await q("insert into suppliers(company_id,code,name) values ($1,'S1','Steel Co') returning id", [co]))[0].id;
  await o.end();
  const w: World = { companyId: co, userId, plantId: plant, stockLoc, qLoc, wc, customerId, supplierId, items, user2,
    ctx: (role: Role = "owner", uid?: string) => ({ companyId: co, userId: uid ?? (role === "owner" ? userId : user2), role, plantIds: [] }) };
  return w;
}
export const inCo = <T>(w: World, fn: (c: import("@/lib/server/db").Db) => Promise<T>) => tx(fn, { companyId: w.companyId, userId: w.userId });
