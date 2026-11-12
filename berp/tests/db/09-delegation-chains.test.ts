import { beforeAll, describe, expect, test } from "vitest";
import { admin, as, CUST, ITEM, seed, U, WH } from "./helpers";

beforeAll(seed);
type Row = Record<string, any>;
const who = (c: any, u: keyof typeof U) => c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[u] })]);
const order = async (c: any, qty: number) => (await c.q("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["GAD-1"], qty }])]))[0].id as string;
const today = () => new Date().toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("two-step approval chains", () => {
  test("manager then owner; different people; the order stays blocked until both approve", async () => {
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      await c.q("select public.save_approval_rule('sales_order',200000,'manager',current_date,'owner')");
      expect(await c.err("select public.save_approval_rule('sales_order',300000,'owner',current_date,'owner')")).toMatch(/manager first, then owner/);
      await who(c, "salesA");
      const o = await order(c, 10);
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o]))[0]!.id;
      expect((await c.q<Row>("select second_role r from public.approvals where id=$1", [ap]))[0]!.r).toBe("owner");
      await who(c, "managerA");
      expect(await c.err("select * from public.confirm_sales_order($1)", [o])).toMatch(/approval required/); // even the manager cannot skip a two-step chain
      await c.q("select public.decide_approval($1,true)", [ap]);
      expect((await c.q<Row>("select status from public.approvals where id=$1", [ap]))[0]!.status).toBe("pending_second");
      await who(c, "salesA");
      expect(await c.err("select * from public.confirm_sales_order($1)", [o])).toMatch(/approval required/);
      await who(c, "managerA");
      expect(await c.err("select public.decide_approval($1,true)", [ap])).toMatch(/needs a owner/); // step two is the owner's
      await who(c, "ownerA");
      await c.q("select public.decide_approval($1,true)", [ap]);
      expect((await c.q<Row>("select status from public.approvals where id=$1", [ap]))[0]!.status).toBe("approved");
      await who(c, "salesA");
      await c.q("select * from public.confirm_sales_order($1)", [o]);
    });
  });
  test("a rejection at step one ends the chain; the requester cannot be the second approver", async () => {
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      await c.q("select public.save_approval_rule('sales_order',200000,'manager',current_date,'owner')");
      const o = await order(c, 10); // the owner raises it
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o]))[0]!.id;
      await who(c, "managerA");
      await c.q("select public.decide_approval($1,true)", [ap]);
      await who(c, "ownerA");
      expect(await c.err("select public.decide_approval($1,true)", [ap])).toMatch(/cannot approve your own/);
      const o2 = await order(c, 10);
      const ap2 = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o2]))[0]!.id;
      await who(c, "managerA");
      await c.q("select public.decide_approval($1,false,'price not agreed with the customer')", [ap2]);
      expect((await c.q<Row>("select status from public.approvals where id=$1", [ap2]))[0]!.status).toBe("rejected");
      await who(c, "ownerA");
      expect(await c.err("select public.decide_approval($1,true)", [ap2])).toMatch(/not pending/);
    });
  });
});

describe("delegation", () => {
  test("a delegate acts while the window is open, never on their own request, and not after revocation", async () => {
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      await c.q("select public.save_approval_rule('sales_order',200000,'manager')");
      const o = await order(c, 10);
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o]))[0]!.id;
      await who(c, "purchA");
      expect(await c.err("select public.decide_approval($1,true)", [ap])).toMatch(/needs a manager/);
      await who(c, "managerA");
      expect(await c.err("select public.create_delegation($1,current_date,current_date + 200)", [U.salesA])).toMatch(/at most 90 days/);
      expect(await c.err("select public.create_delegation($1,current_date,current_date + 5)", [U.managerA])).toMatch(/yourself/);
      expect(await c.err("select public.create_delegation($1,current_date,current_date + 5)", [U.viewerA])).toMatch(/not a viewer/);
      const dg = (await c.q<Row>("select public.create_delegation($1,current_date,current_date + 5) id", [U.salesA]))[0]!.id;
      await who(c, "salesA");
      await c.q("select public.decide_approval($1,true)", [ap]);
      expect((await c.q<Row>("select status, delegated_from from public.approvals where id=$1", [ap]))[0]).toMatchObject({ status: "approved", delegated_from: U.managerA });
      // revoked → no authority
      await who(c, "ownerA");
      const o2 = await order(c, 10);
      const ap2 = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o2]))[0]!.id;
      await who(c, "managerA");
      await c.q("select public.revoke_delegation($1)", [dg]);
      await who(c, "salesA");
      expect(await c.err("select public.decide_approval($1,true)", [ap2])).toMatch(/needs a manager/);
      // re-delegated, but a request the delegate raised themselves is still off limits
      await who(c, "managerA");
      await c.q("select public.create_delegation($1,current_date,current_date + 5)", [U.salesA]);
      await who(c, "salesA");
      const mine = await order(c, 10);
      const apMine = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [mine]))[0]!.id;
      expect(await c.err("select public.decide_approval($1,true)", [apMine])).toMatch(/cannot approve your own/);
    });
  });

  test("a delegate cannot approve what the delegator asked for; an expired window grants nothing", async () => {
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      await c.q("select public.save_approval_rule('sales_order',200000,'manager')");
      await who(c, "managerA");
      await c.q("select public.create_delegation($1,current_date,current_date + 5)", [U.salesA]);
      const o = await order(c, 10);
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o]))[0]!.id; // raised by the delegator
      await who(c, "salesA");
      expect(await c.err("select public.decide_approval($1,true)", [ap])).toMatch(/cannot approve your own/);
    });
    // commit a rule + delegation, expire the window out-of-band, then check it grants nothing
    await as("ownerA", async (c) => {
      await c.q("select public.save_approval_rule('sales_order',200000,'manager')");
      await who(c, "managerA");
      await c.q("select public.create_delegation($1,current_date,current_date + 5)", [U.salesA]);
    }, true);
    await admin("update public.approval_delegations set starts_on = current_date - 30, ends_on = current_date - 1");
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      const o = await order(c, 10);
      const ap = (await c.q<Row>("select public.request_approval('sales_order',$1) id", [o]))[0]!.id;
      await who(c, "salesA");
      expect(await c.err("select public.decide_approval($1,true)", [ap])).toMatch(/needs a manager/);
    });
    await admin("delete from public.approval_delegations; delete from public.approval_rules");
  });
});
