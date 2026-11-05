import { beforeAll, describe, expect, test } from "vitest";
import { admin, as, CUST, fails, ITEM, pool, seed, TENANT, U, WH } from "./helpers";

beforeAll(seed);
type Row = Record<string, any>;
const asService = async <T>(fn: (q: (sql: string, p?: unknown[]) => Promise<Row[]>) => Promise<T>) => {
  const conn = await pool.connect();
  try { await conn.query("set role service_role"); return await fn(async (sql, p) => (await conn.query(sql, p)).rows); } finally { await conn.query("reset role"); conn.release(); }
};

describe("subscription billing events", () => {
  test("only the service role can apply provider events; they are idempotent; failure starts a 7-day grace", async () => {
    expect(await fails("ownerA", "select public.apply_provider_event('e0',$1,$2,'growth','sub_1')", ["charged", TENANT.A])).toMatch(/permission denied/);
    await asService(async (q) => {
      expect((await q("select public.apply_provider_event('evt_f1','failed',$1,'growth','sub_1') r", [TENANT.B]))[0]!.r).toBe(true);
      expect((await q("select public.apply_provider_event('evt_f1','failed',$1,'growth','sub_1') r", [TENANT.B]))[0]!.r).toBe(false);
    });
    expect((await admin<Row>("select status, past_due_since is not null d from public.tenants where id=$1", [TENANT.B]))[0]).toMatchObject({ status: "past_due", d: true });
    expect((await admin("select 1 from public.subscription_events where tenant_id=$1 and kind='payment_failed'", [TENANT.B])).length).toBe(1);
    // inside the grace window writes still work; after it, they stop
    await as("ownerB", (c) => c.q("select public.create_sales_order(gen_random_uuid(), gen_random_uuid(), '[]')")).catch((e) => expect(e.message).not.toMatch(/overdue/));
    await admin("update public.tenants set past_due_since = now() - interval '8 days' where id=$1", [TENANT.B]);
    expect(await fails("ownerB", "select public.create_sales_order(gen_random_uuid(), gen_random_uuid(), '[]')")).toMatch(/payment overdue/);
    await asService((q) => q("select public.apply_provider_event('evt_c1','charged',$1,'growth','sub_1')", [TENANT.B]));
    expect((await admin<Row>("select status, past_due_since from public.tenants where id=$1", [TENANT.B]))[0]).toMatchObject({ status: "active", past_due_since: null });
  });
  test("a trial owner cannot self-upgrade without a confirmed charge", async () => {
    await admin("update public.tenants set status='trial', plan_code='trial', trial_ends_at=now()+interval '5 days' where id=$1", [TENANT.B]);
    expect(await fails("ownerB", "select public.change_plan('scale')")).toMatch(/complete payment first/);
    await admin("update public.tenants set status='active', plan_code='growth' where id=$1", [TENANT.B]);
  });
});

describe("API keys", () => {
  test("secret shown once, stored hashed, resolves to its tenant, revocable, rate limited", async () => {
    const secret = (await as("ownerA", (c) => c.q<Row>("select public.create_api_key('Reporting') s", []), true))[0]!.s as string;
    expect(secret).toMatch(/^berp_[0-9a-f]{64}$/);
    const stored = await admin<Row>("select secret_hash, prefix from public.api_keys where tenant_id=$1", [TENANT.A]);
    expect(JSON.stringify(stored)).not.toContain(secret.slice(5));
    expect(await fails("salesA", "select public.create_api_key('x y')")).toMatch(/role not permitted/);
    expect(await as("salesA", (c) => c.q("select id from public.api_keys"))).toHaveLength(0);
    expect(await fails("ownerA", "select public.api_resolve_key($1)", [secret])).toMatch(/permission denied/);
    await asService(async (q) => {
      expect((await q("select public.api_resolve_key($1) t", [secret]))[0]!.t).toBe(TENANT.A);
      await expect(q("select public.api_resolve_key('berp_nope')")).rejects.toThrow(/invalid api key/);
    });
    await admin("insert into app.api_hits (key_id, minute, n) select id, date_trunc('minute', now()), 120 from public.api_keys where tenant_id=$1 on conflict (key_id, minute) do update set n = 120", [TENANT.A]);
    await asService(async (q) => { await expect(q("select public.api_resolve_key($1)", [secret])).rejects.toThrow(/rate limit/); });
    await admin("delete from app.api_hits");
    const id = (await admin<Row>("select id from public.api_keys where tenant_id=$1", [TENANT.A]))[0]!.id;
    await as("ownerA", (c) => c.q("select public.revoke_api_key($1)", [id]), true);
    await asService(async (q) => { await expect(q("select public.api_resolve_key($1)", [secret])).rejects.toThrow(/invalid api key/); });
  });
});

describe("projects, time, expenses, milestone billing", () => {
  test("approval flow, separation of duties, cost summary, and milestone invoice through the normal ledger", async () => {
    await as("ownerA", async (c) => {
      const svc = ITEM["SVC-1"];
      const prj = (await c.q<Row>("select public.create_project('Warehouse fit-out',$1,5000000) id", [CUST["Kiran Stores"]]))[0]!.id;
      const ms = (await c.q<Row>("select public.add_milestone($1,'Phase 1',1000000) id", [prj]))[0]!.id;
      const t1 = (await c.q<Row>("select public.log_time($1,current_date,6.5,0,'site survey') id", [prj]))[0]!.id;
      const e1 = (await c.q<Row>("select public.log_expense($1,current_date,45000,'Fuel') id", [prj]))[0]!.id;
      expect(await c.err("select public.decide_project_entry('time',$1,true)", [t1])).toMatch(/cannot approve your own/);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.managerA })]);
      expect(await c.err("select public.decide_project_entry('expense',$1,false,'')", [e1])).toMatch(/reason is required/);
      expect(await c.err("select public.close_project($1)", [prj])).toMatch(/pending/);
      await c.q("select public.decide_project_entry('time',$1,true,null,40000)", [t1]);
      await c.q("select public.decide_project_entry('expense',$1,true)", [e1]);
      const cost = (await c.q<Row>("select labour_paise l, expense_paise e, budget_paise b from public.project_costs where project_id=$1", [prj]))[0]!;
      expect([cost.l, cost.e, cost.b]).toEqual([260000, 45000, 5000000]);
      const before = Number((await c.q<Row>("select balance_paise b from public.trial_balance where code='1100'"))[0]!.b);
      const inv = (await c.q<Row>("select public.bill_milestone($1,$2,$3) id", [ms, svc, WH.A]))[0]!.id;
      expect((await c.q<Row>("select total_paise t from public.invoices where id=$1", [inv]))[0]!.t).toBe(1180000); // 10,00,000 + 18% GST
      expect(Number((await c.q<Row>("select balance_paise b from public.trial_balance where code='1100'"))[0]!.b) - before).toBe(1180000);
      expect(await c.err("select public.bill_milestone($1,$2,$3)", [ms, svc, WH.A])).toMatch(/already billed/);
    });
  });
  test("staff see only their own time; cost data is hidden from them", async () => {
    await as("ownerA", async (c) => {
      const prj = (await c.q<Row>("select public.create_project('Hidden rates',null,0) id"))[0]!.id;
      await c.q("select public.log_time($1,current_date,2,50000,'mgr work')", [prj]);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.salesA })]);
      await c.q("select public.log_time($1,current_date,1,99999,'my work')", [prj]);
      const mine = await c.q<Row>("select cost_rate_paise r from public.project_time where project_id=$1", [prj]);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.r).toBe(0); // staff cannot stamp their own rate
      expect(await c.q("select * from public.project_costs")).toHaveLength(0);
    });
  });
});

describe("people", () => {
  test("HR data is private; leave rules; offboarding revokes access immediately", async () => {
    await as("ownerA", async (c) => {
      await c.q("insert into public.employees (tenant_id, code, full_name, job_title, user_id, email) select app.tenant_id(),'E1','Sana Whitfield','Storekeeper',$1,'wh@example.test'", [U.whA]);
      await c.q("insert into public.employees (tenant_id, code, full_name, user_id) select app.tenant_id(),'E2','Dev Menon',$1", [U.salesA]);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.whA })]);
      expect((await c.q("select * from public.employees")).map((r: any) => r.code)).toEqual(["E1"]); // only self
      const lr = (await c.q<Row>("select public.request_leave(current_date+3, current_date+4, 'casual', 'family') id"))[0]!.id;
      expect(await c.err("select public.request_leave(current_date+4, current_date+6, 'sick', '')")).toMatch(/overlap/);
      expect(await c.err("select public.decide_leave($1,true)", [lr])).toMatch(/role not permitted/);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.managerA })]);
      expect(await c.err("select public.decide_leave($1,false,'')", [lr])).toMatch(/reason is required/);
      await c.q("select public.decide_leave($1,true)", [lr]);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.salesA })]);
      expect(await c.q("select * from public.employees")).toHaveLength(1); // sales sees only own record
      expect(await c.q("select * from public.leave_requests")).toHaveLength(0);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.ownerA })]);
      const e2 = (await c.q<Row>("select id from public.employees where code='E2'"))[0]!.id;
      await c.q("select public.offboard_employee($1,current_date)", [e2]);
      expect((await c.q<Row>("select active from public.memberships where user_id=$1 and tenant_id=app.tenant_id()", [U.salesA]))[0]!.active).toBe(false);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.salesA })]);
      expect(await c.q("select * from public.customers")).toHaveLength(0); // access gone with the next request
    });
  });
});

describe("assets and maintenance", () => {
  test("breakdown → work order → spares consumed from stock → expense posted → asset back in service", async () => {
    await as("ownerA", async (c) => {
      await c.q("select public.adjust_stock($1,$2,5,'spares')", [ITEM["GAD-1"], WH.A]);
      const a = (await c.q<Row>("select public.register_asset('FRK-01','Forklift','Vehicles',$1,45000000,current_date+200,90) id", [WH.A]))[0]!.id;
      const wo = (await c.q<Row>("select public.open_work_order($1,'breakdown','hydraulic leak') id", [a]))[0]!.id;
      expect((await c.q<Row>("select status from public.assets where id=$1", [a]))[0]!.status).toBe("under_repair");
      expect(await c.err("select public.dispose_asset($1,'scrapped for good')", [a])).toMatch(/close open work orders/);
      const stock0 = Number((await c.q<Row>("select on_hand from public.stock_levels where item_id=$1 and warehouse_id=$2", [ITEM["GAD-1"], WH.A]))[0]!.on_hand);
      await c.q("select public.close_work_order($1,'seal replaced',$2,2,$3,30000)", [wo, ITEM["GAD-1"], WH.A]);
      expect(Number((await c.q<Row>("select on_hand from public.stock_levels where item_id=$1 and warehouse_id=$2", [ITEM["GAD-1"], WH.A]))[0]!.on_hand)).toBe(stock0 - 2);
      expect(Number((await c.q<Row>("select balance_paise b from public.trial_balance where code='5100'"))[0]!.b)).toBe(60000); // 2×15,000 spares + 30,000 labour
      expect((await c.q<Row>("select status from public.assets where id=$1", [a]))[0]!.status).toBe("active");
      expect(await c.err("select public.close_work_order($1,'again',null,null,$2,0)", [wo, WH.A])).toMatch(/already closed/);
      await c.q("select public.dispose_asset($1,'sold at auction')", [a]);
      expect(await c.err("select public.open_work_order($1,'scheduled','service')", [a])).toMatch(/disposed/);
    });
  });
});
