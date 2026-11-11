import { beforeAll, describe, expect, test } from "vitest";
import { as, CUST, ITEM, seed, U, WH } from "./helpers";

beforeAll(seed);
type Row = Record<string, any>;
const who = (c: any, u: keyof typeof U) => c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[u] })]);
const order = async (c: any, qty: number) =>
  (await c.q("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["GAD-1"], qty }])]))[0].id as string;

describe("approval rules", () => {
  test("only the owner manages rules; a rule nobody could approve is refused", async () => {
    await as("managerA", async (c) => expect(await c.err("select public.save_approval_rule('sales_order',100,'manager')")).toMatch(/role not permitted/));
    await as("ownerA", async (c) => {
      expect(await c.err("select public.save_approval_rule('sales_order',0,'manager')")).toMatch(/check|violates/);
      expect(await c.err("select public.save_approval_rule('sales_order',100,'sales')")).toMatch(/check|invalid input|approver must/);
    });
  });

  test("a large order is held until a manager approves; small ones are not gated", async () => {
    await as("ownerA", async (c) => {
      await c.q("select public.save_approval_rule('sales_order',200000,'manager')");
      await who(c, "salesA");
      const small = await order(c, 2); // 59,118
      await c.q("select * from public.confirm_sales_order($1)", [small]);
      const big = await order(c, 10); // 295,590
      expect(await c.err("select * from public.confirm_sales_order($1)", [big])).toMatch(/approval required.*manager/);
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [big]))[0]!.id;
      expect(await c.err("select public.request_approval('sales_order',$1)", [big])).toMatch(/unique|duplicate/); // one pending at a time
      expect(await c.err("select public.decide_approval($1,true)", [ap])).toMatch(/needs a manager/);
      await who(c, "managerA");
      expect(await c.err("select public.decide_approval($1,false,'')", [ap])).toMatch(/reason is required/);
      await c.q("select public.decide_approval($1,true)", [ap]);
      expect(await c.err("select public.decide_approval($1,true)", [ap])).toMatch(/not pending/);
      await who(c, "salesA");
      await c.q("select * from public.confirm_sales_order($1)", [big]);
      expect((await c.q<Row>("select status from public.sales_orders where id=$1", [big]))[0]!.status).toBe("confirmed");
    });
  });

  test("nobody approves their own request; the approver can act directly; owner outranks manager", async () => {
    await as("ownerA", async (c) => {
      await c.q("select public.save_approval_rule('sales_order',200000,'manager')");
      await who(c, "managerA");
      const o = await order(c, 10);
      await c.q("select * from public.confirm_sales_order($1)", [o]); // manager satisfies the rule on their own
      const o2 = await order(c, 10);
      await who(c, "salesA");
      const o3 = await order(c, 10);
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o3]))[0]!.id;
      await who(c, "ownerA");
      await c.q("select public.decide_approval($1,false,'too risky for this customer')", [ap]);
      await who(c, "salesA");
      expect(await c.err("select * from public.confirm_sales_order($1)", [o3])).toMatch(/approval required/); // rejected ≠ approved
      expect((await c.q<Row>("select status from public.approvals where id=$1", [ap]))[0]!.status).toBe("rejected");
      void o2;
    });
  });

  test("changing a rule never re-routes a request already open; effective dates apply", async () => {
    await as("ownerA", async (c) => {
      await c.q("select public.save_approval_rule('sales_order',200000,'manager')");
      await who(c, "salesA");
      const o = await order(c, 10);
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o]))[0]!.id;
      await who(c, "ownerA");
      await c.q("select public.deactivate_approval_rule(id) from public.approval_rules where active");
      await c.q("select public.save_approval_rule('sales_order',200000,'owner')");
      expect((await c.q<Row>("select required_role r from public.approvals where id=$1", [ap]))[0]!.r).toBe("manager"); // stamped at request time
      await who(c, "managerA");
      await c.q("select public.decide_approval($1,true)", [ap]); // still decidable by the originally required role
      await who(c, "ownerA");
      await c.q("select public.save_approval_rule('sales_order',999999999,'owner', current_date + 30)");
      await who(c, "salesA");
      expect(await c.err("select * from public.confirm_sales_order($1)", [o])).toBe(""); // approved earlier, covers the amount
    });
  });

  test("purchase requests above the threshold need a manager to turn them into purchase orders", async () => {
    await as("ownerA", async (c) => {
      await c.q("select public.save_approval_rule('purchase_request',1000000,'manager')");
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      await who(c, "salesA");
      const so = await order(c, 4000); // forces a large shortage for GAD-1
      await who(c, "ownerA");
      await c.q("select * from public.confirm_sales_order($1)", [so]);
      await c.q("select public.request_shortage_purchases($1)", [so]);
      const pr = (await c.q<Row>("select id from public.purchase_requests where so_line_id in (select id from public.sales_order_lines where order_id=$1)", [so]))[0]!.id;
      const sup = (await c.q<Row>("select id from public.suppliers limit 1"))[0]!.id;
      await who(c, "purchA");
      expect(await c.err("select public.approve_purchase_request($1,$2,15000)", [pr, sup])).toMatch(/approval required/);
      const ap = (await c.q<Row>("select public.request_approval('purchase_request',$1) id", [pr]))[0]!.id;
      await who(c, "managerA");
      await c.q("select public.decide_approval($1,true)", [ap]);
      await who(c, "purchA");
      await c.q("select public.approve_purchase_request($1,$2,15000)", [pr, sup]);
      expect((await c.q<Row>("select status from public.purchase_requests where id=$1", [pr]))[0]!.status).toBe("approved");
    });
  });
});
