import "server-only";
import type { Db } from "./db";
/** Demonstration data only — loaded on request into an empty workspace, never at install time. */
export async function seedSample(c: Db, co: string, userId: string) {
  const q = async (s: string, p: unknown[] = []) => (await c.query(s, p)).rows;
  const plant = (await q("insert into plants(company_id,code,name) values ($1,'SMP-P1','Sample Plant') on conflict (company_id,code) do update set name=excluded.name returning id", [co]))[0].id;
  const loc = async (code: string, kind: string) => (await q("insert into locations(company_id,plant_id,code,name,kind) values ($1,$2,$3,$3,$4) on conflict (company_id,code) do update set kind=excluded.kind returning id", [co, plant, code, kind]))[0].id;
  const stock = await loc("SMP-STORES", "stock"); await loc("SMP-QUARANTINE", "quarantine"); await loc("SMP-DISPATCH", "dispatch");
  for (const [c1, n] of [["EA", "Each"], ["KG", "Kilogram"], ["M", "Metre"]]) await q("insert into uoms(company_id,code,name) values ($1,$2,$3) on conflict do nothing", [co, c1, n]);
  for (let d = 1; d <= 5; d++) await q("insert into shift_calendar(company_id,plant_id,weekday) values ($1,$2,$3) on conflict do nothing", [co, plant, d]);
  const wc = async (code: string, rate: number) => (await q("insert into work_centres(company_id,plant_id,code,name,cost_rate_per_hour_paise,overhead_pct) values ($1,$2,$3,$3,$4,40) on conflict (company_id,code) do update set name=excluded.name returning id", [co, plant, code, rate]))[0].id;
  const cnc = await wc("SMP-CNC", 60000), asm = await wc("SMP-ASSY", 30000);
  await q("insert into machines(company_id,work_centre_id,code,name,pm_interval_days) values ($1,$2,'SMP-CNC-1','CNC lathe 1',90) on conflict do nothing", [co, cnc]);
  const item = async (code: string, kind: string, tracking: string, lot: number, lt: number, std: number) => (await q("insert into items(company_id,code,name,kind,uom,tracking,lot_size,lead_time_days,std_cost_paise) values ($1,$2,$3,$4,'EA',$5,$6,$7,$8) returning id", [co, "SAMPLE-" + code, "Sample " + code.toLowerCase(), kind, tracking, lot, lt, std]))[0].id;
  const pump = await item("PUMP", "make", "batch", 1, 3, 450000), body = await item("BODY", "make", "none", 1, 2, 150000), shaft = await item("SHAFT", "buy", "batch", 10, 7, 40000), seal = await item("SEAL", "buy", "none", 50, 5, 5000), bolt = await item("BOLT", "buy", "none", 100, 4, 800);
  for (const i of [pump, body, shaft, seal, bolt]) await q("insert into item_revisions(company_id,item_id,rev,approved_by) values ($1,$2,'A',$3)", [co, i, userId]);
  const bom = async (parent: string, lines: [string, number, number][]) => { const b = (await q("insert into boms(company_id,item_id,version) values ($1,$2,1) returning id", [co, parent]))[0].id; for (const [comp, qq, sc] of lines) await q("insert into bom_lines(company_id,bom_id,component_item_id,qty_per,scrap_pct) values ($1,$2,$3,$4,$5)", [co, b, comp, qq, sc]); await q("update boms set status='released' where id=$1", [b]); };
  await bom(pump, [[body, 1, 0], [shaft, 1, 0], [seal, 2, 0], [bolt, 8, 2]]); await bom(body, [[shaft, 0.5, 0]]);
  for (const [it, w, setup, run] of [[pump, asm, 20, 25], [body, cnc, 30, 18]] as const) { const r = (await q("insert into routings(company_id,item_id,version,status) values ($1,$2,1,'released') returning id", [co, it]))[0].id; await q("insert into routing_ops(company_id,routing_id,seq,name,work_centre_id,setup_min,run_min_per_unit) values ($1,$2,10,'Main operation',$3,$4,$5)", [co, r, w, setup, run]); }
  await q("insert into customers(company_id,code,name,email) values ($1,'SMP-CUST','Sample Customer Ltd','buyer@example.com')", [co]);
  await q("insert into suppliers(company_id,code,name,email) values ($1,'SMP-SUP','Sample Supplier Pvt Ltd','sales@example.com')", [co]);
  for (const [it, qq, cost] of [[bolt, 400, 800], [seal, 100, 5000]] as const) await q("insert into stock_movements(company_id,item_id,location_id,qty,kind,note,unit_cost_paise,posted_by) values ($1,$2,$3,$4,'adjust','Sample opening stock',$5,$6)", [co, it, stock, qq, cost, userId]);
}
