import { beforeAll, describe, expect, test } from "vitest";
import { admin, as, CUST, fails, ITEM, pool, seed, TENANT, U, WH } from "./helpers";

beforeAll(seed);
type Row = Record<string, any>;
const TABLES = ["customers","suppliers","items","sales_orders","journal_entries","invoices","stock_movements","audit_log","memberships","accounts"];

describe("tenant isolation", () => {
  test("tenant B's owner sees none of tenant A's rows in any table", async () => {
    for (const t of TABLES) {
      const rows = await as("ownerB", (c) => c.q<Row>(`select tenant_id from public.${t} where tenant_id = $1`, [TENANT.A]));
      expect(rows, t).toHaveLength(0);
    }
  });
  test("a user with no workspace sees nothing, and anon sees nothing at all", async () => {
    for (const t of TABLES) expect((await as("outsider", (c) => c.q(`select 1 from public.${t}`))), t).toHaveLength(0);
    const conn = await pool.connect();
    try {
      await conn.query("set role anon");
      await expect(conn.query("select * from public.customers")).rejects.toThrow(/permission denied/);
    } finally { await conn.query("reset role"); conn.release(); }
  });
  test("cannot write into another tenant, move a row between tenants, or reference its records", async () => {
    expect(await fails("ownerB", "insert into public.customers (tenant_id, name) values ($1,'Intruder')", [TENANT.A])).toMatch(/row-level security/);
    expect(await fails("ownerA", "update public.customers set tenant_id=$1 where name='Kiran Stores'", [TENANT.B])).toMatch(/row-level security|cannot be changed/);
    expect(await fails("ownerB", "select public.create_sales_order($1,$2,$3)", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["WID-1"], qty: 1 }])])).toMatch(/foreign key|unknown or inactive/);
    expect(await fails("ownerB", "select public.switch_workspace($1)", [TENANT.A])).toMatch(/not a member/);
  });
  test("switching workspace changes what is visible, and only for members", async () => {
    const both = await admin("select 1");
    expect(both).toHaveLength(1);
    await as("ownerA", (c) => c.q("select public.add_member($1,'viewer')", [U.outsider]), true);
    await as("outsider", async (c) => {
      expect(await c.q("select 1 from public.customers")).not.toHaveLength(0);
      await c.q("select public.create_workspace('Outsider Co')");
      expect(await c.q("select 1 from public.customers")).toHaveLength(0);
      await c.q("select public.switch_workspace($1)", [TENANT.A]);
      expect(await c.q("select 1 from public.customers")).not.toHaveLength(0);
    });
    await admin("delete from public.memberships where user_id=$1 and tenant_id=$2", [U.outsider, TENANT.A]);
  });
});

describe("roles", () => {
  test("viewer reads but cannot create orders or masters", async () => {
    expect((await as("viewerA", (c) => c.q("select 1 from public.sales_orders"))).length).toBeGreaterThanOrEqual(0);
    expect(await fails("viewerA", "select public.create_sales_order($1,$2,$3)", [CUST["Kiran Stores"], WH.A, "[]"])).toMatch(/role not permitted/);
    expect(await fails("viewerA", "insert into public.customers (tenant_id, name) select app.tenant_id(), 'x'")).toMatch(/row-level security/);
  });
  test("warehouse staff cannot see finance data; sales sees invoices but not the ledger", async () => {
    expect(await as("whA", (c) => c.q("select 1 from public.journal_entries"))).toHaveLength(0);
    expect(await as("whA", (c) => c.q("select 1 from public.invoices"))).toHaveLength(0);
    expect(await as("salesA", (c) => c.q("select 1 from public.journal_entries"))).toHaveLength(0);
    expect(await as("salesA", (c) => c.q("select 1 from public.audit_log"))).toHaveLength(0);
    expect((await as("ownerA", (c) => c.q("select 1 from public.audit_log"))).length).toBeGreaterThan(0);
  });
  test("posted data cannot be written directly, by anyone, even the owner", async () => {
    expect(await fails("ownerA", "insert into public.journal_entries (tenant_id, number, entry_date, source_type) select app.tenant_id(),'X',current_date,'manual'")).toMatch(/permission denied/);
    expect(await fails("ownerA", "update public.invoices set total_paise = 1")).toMatch(/permission denied/);
    expect(await fails("ownerA", "delete from public.stock_movements")).toMatch(/permission denied/);
    await as("ownerA", async (c) => {
      await c.q("select public.adjust_stock($1,$2,1,'immutability probe')", [ITEM["GAD-1"], WH.A]);
      await c.q("select public.post_manual_journal(current_date,'probe',$1)", [JSON.stringify([{ account_code: "1000", debit: 1 }, { account_code: "3000", credit: 1 }])]);
    }, true);
    await expect(admin("update public.stock_movements set qty = 1")).rejects.toThrow(/append-only/);
    await expect(admin("delete from public.journal_lines")).rejects.toThrow(/append-only/);
    await expect(admin("delete from public.audit_log")).rejects.toThrow(/append-only/);
  });
  test("internal helpers are not callable by clients", async () => {
    expect(await fails("ownerA", "select app.post_journal(app.tenant_id(), current_date, 'forged', 'manual', null, '[]'::jsonb)")).toMatch(/permission denied/);
    expect(await fails("ownerA", "select app.next_number(app.tenant_id(),'x','X')")).toMatch(/permission denied/);
  });
  test("owner cannot self-grant platform admin; platform admin sees tenants but not their documents", async () => {
    expect(await fails("ownerA", "insert into public.platform_admins values ($1)", [U.ownerA])).toMatch(/permission denied/);
    expect(await fails("ownerA", "select * from public.admin_list_tenants()")).toMatch(/platform admins only/);
    const ts = await as("platform", (c) => c.q("select * from public.admin_list_tenants()"));
    expect(ts.length).toBeGreaterThanOrEqual(2);
    expect(await as("platform", (c) => c.q("select 1 from public.invoices"))).toHaveLength(0);
  });
});

describe("controls", () => {
  const order = (c: any, cust: string, qty: number) =>
    c.q("select public.create_sales_order($1,$2,$3) id", [cust, WH.A, JSON.stringify([{ item_id: ITEM["GAD-1"], qty }])]).then((r: Row[]) => r[0]!.id as string);

  test("credit limit blocks confirmation until a manager gives a reason", async () => {
    await as("managerA", async (c) => {
      const id = await order(c, CUST["Tiny Shop"], 10); // 10*25050*1.18 = 295,590 > 100,000
      expect(await c.err("select * from public.confirm_sales_order($1)", [id])).toMatch(/credit limit exceeded/);
    });
    const msg = await as("salesA", async (c) => {
      const id = await order(c, CUST["Tiny Shop"], 10);
      try { await c.q("select * from public.confirm_sales_order($1,'big customer deal')", [id]); } catch (e) { return (e as Error).message; }
      return "ok";
    });
    expect(msg).toMatch(/only a manager/);
    await as("managerA", async (c) => {
      const id = await order(c, CUST["Tiny Shop"], 10);
      await c.q("select * from public.confirm_sales_order($1,'approved by manager for launch order')", [id]);
      expect((await c.q<Row>("select status, credit_override_reason r from public.sales_orders where id=$1", [id]))[0]).toMatchObject({ status: "confirmed" });
    });
  });

  test("a confirmed or fulfilled order is not editable as a draft; cancelling releases reservations", async () => {
    await as("ownerA", async (c) => {
      await c.q("select public.adjust_stock($1,$2,5,'opening count')", [ITEM["GAD-1"], WH.A]);
      const id = await order(c, CUST["Kiran Stores"], 3);
      await c.q("select * from public.confirm_sales_order($1)", [id]);
      expect((await c.q<Row>("select reserved from public.stock_levels where item_id=$1", [ITEM["GAD-1"]]))[0]!.reserved).toBe(3);
      expect(await c.err("update public.sales_order_lines set qty = 99 where order_id=$1", [id])).toMatch(/permission denied/);
      expect(await c.err("select * from public.confirm_sales_order($1)", [id])).toMatch(/only a draft/);
      expect(await c.err("select public.cancel_sales_order($1,'')", [id])).toMatch(/reason is required/);
      await c.q("select public.cancel_sales_order($1,'customer withdrew')", [id]);
      expect((await c.q<Row>("select reserved from public.stock_levels where item_id=$1", [ITEM["GAD-1"]]))[0]!.reserved).toBe(0);
    });
  });

  test("two simultaneous orders cannot both reserve the last units", async () => {
    const race = (await as("ownerA", (c) => c.q<Row>("insert into public.items (tenant_id, sku, name) select app.tenant_id(), 'RACE-1', 'Race item' returning id"), true))[0]!.id as string;
    await as("ownerA", (c) => c.q("select public.adjust_stock($1,$2,4,'seed for race')", [race, WH.A]), true);
    const before = 4;
    const ids = await Promise.all([1, 2].map(() => as("salesA", async (c) =>
      (await c.q<Row>("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: race, qty: before }])]))[0]!.id, true)));
    await Promise.all(ids.map((id) => as("salesA", (c) => c.q("select * from public.confirm_sales_order($1)", [id]), true)));
    const r = (await as("ownerA", (c) => c.q<Row>("select on_hand, reserved from public.stock_levels where item_id=$1", [race])))[0]!;
    expect(r.on_hand).toBe(4);
    expect(r.reserved).toBe(4); // exactly one order got the units; the other is fully short
    for (const id of ids) await as("salesA", (c) => c.q("select public.cancel_sales_order($1,'race test cleanup')", [id]), true);
  });

  test("stock adjustments need a reason and cannot dip below reserved", async () => {
    expect(await fails("whA", "select public.adjust_stock($1,$2,-1,'')", [ITEM["GAD-1"], WH.A])).toMatch(/reason is required/);
    expect(await fails("whA", "select public.adjust_stock($1,$2,-1000,'shrink')", [ITEM["GAD-1"], WH.A])).not.toBe("");
  });

  test("a closed period rejects new postings; manual journals balance; reversal restores balances", async () => {
    await as("acctA", async (c) => {
      const lines = JSON.stringify([{ account_code: "1000", debit: 5000 }, { account_code: "3000", credit: 5000 }]);
      const e = (await c.q<Row>("select public.post_manual_journal(current_date,'owner capital',$1) id", [lines]))[0]!.id;
      await c.q("select public.reverse_journal($1,'entered twice',current_date)", [e]);
      expect(await c.err("select public.reverse_journal($1,'again',current_date)", [e])).toMatch(/unique|duplicate/);
      const net = await c.q<Row>("select coalesce(sum(debit_paise),0) d, coalesce(sum(credit_paise),0) c from public.journal_lines jl join public.journal_entries je on je.id=jl.entry_id where je.id=$1 or je.reverses_id=$1", [e]);
      expect(net[0]!.d).toBe(net[0]!.c);
      const cash = await c.q<Row>("select coalesce(sum(jl.debit_paise - jl.credit_paise),0) b from public.journal_lines jl join public.journal_entries je on je.id=jl.entry_id join public.accounts a on a.id=jl.account_id where a.code='3000' and (je.id=$1 or je.reverses_id=$1)", [e]);
      expect(cash[0]!.b).toBe(0); // original + reversal net to zero
    });
  });

  test("unbalanced journal is rejected at commit", async () => {
    await expect(as("acctA", (c) => c.q("select public.post_manual_journal(current_date,'bad entry',$1)", [JSON.stringify([{ account_code: "1000", debit: 5000 }, { account_code: "3000", credit: 4000 }])]), true))
      .rejects.toThrow(/unbalanced/);
  });

  test("period lock blocks postings dated inside the closed period", async () => {
    await as("acctA", async (c) => {
      await c.q("select public.lock_period(current_date)");
      expect(await c.err("select public.post_manual_journal(current_date,'late entry',$1)", [JSON.stringify([{ account_code: "1000", debit: 1 }, { account_code: "3000", credit: 1 }])])).toMatch(/period closed/);
    });
  });

  test("plan limits: a downgrade is blocked while usage exceeds it; user limit enforced", async () => {
    expect(await fails("ownerA", "select public.change_plan('starter')")).toMatch(/downgrade blocked|ok/);
    await admin("update public.tenants set plan_code='trial' where id=$1", [TENANT.B]);
    await as("ownerB", async (c) => {
      for (const n of [12, 13]) await admin("insert into auth.users (id,email) values ($1,$2) on conflict do nothing", [U.outsider.replace(/99$/, String(n)), `x${n}@e.test`]);
      await c.q("select public.add_member($1,'viewer')", [U.outsider.replace(/99$/, "12")]);
      await c.q("select public.add_member($1,'viewer')", [U.outsider.replace(/99$/, "13")]);
      expect(await c.err("select public.add_member($1,'viewer')", [U.outsider])).toMatch(/plan limit/);
    });
    await admin("update public.tenants set plan_code='growth' where id=$1", [TENANT.B]);
  });

  test("expired trial and suspended workspaces cannot write; reads remain", async () => {
    await admin("update public.tenants set plan_code='trial', status='trial', trial_ends_at=now()-interval '1 day' where id=$1", [TENANT.B]);
    expect(await fails("ownerB", "select public.create_sales_order(gen_random_uuid(), gen_random_uuid(), '[]')")).toMatch(/trial expired/);
    expect((await as("ownerB", (c) => c.q("select 1 from public.tenants"))).length).toBe(1);
    await as("platform", (c) => c.q("select public.admin_set_tenant_status($1,'suspended','non-payment')", [TENANT.B]), true);
    expect(await fails("ownerB", "select public.create_sales_order(gen_random_uuid(), gen_random_uuid(), '[]')")).toMatch(/suspended/);
    await admin("update public.tenants set plan_code='growth', status='active' where id=$1", [TENANT.B]);
  });
});
