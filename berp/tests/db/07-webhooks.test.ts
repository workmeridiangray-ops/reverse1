import { beforeAll, describe, expect, test } from "vitest";
import { admin, as, CUST, fails, ITEM, pool, seed, TENANT, WH } from "./helpers";

beforeAll(seed);
type Row = Record<string, any>;
const svc = async <T>(fn: (q: (sql: string, p?: unknown[]) => Promise<Row[]>) => Promise<T>) => {
  const conn = await pool.connect();
  try { await conn.query("set role service_role"); return await fn(async (sql, p) => (await conn.query(sql, p)).rows); } finally { await conn.query("reset role"); conn.release(); }
};

describe("outbound webhooks", () => {
  test("only the owner manages endpoints; https only; the secret is shown once and unreadable afterwards", async () => {
    expect(await fails("managerA", "select public.create_webhook('https://example.com/h', array['invoice.created'])")).toMatch(/role not permitted/);
    expect(await fails("ownerA", "select public.create_webhook('http://example.com/h', array['invoice.created'])")).toMatch(/check|violates/);
    expect(await fails("ownerA", "select public.create_webhook('https://user:pw@example.com/h', array['invoice.created'])")).toMatch(/check|violates/);
    expect(await fails("ownerA", "select public.create_webhook('https://example.com/h', array['nope'])")).toMatch(/choose one or more/);
    const secret = (await as("ownerA", (c) => c.q<Row>("select public.create_webhook('https://hooks.example.com/berp', array['invoice.created','payment.received','sales_order.confirmed']) s"), true))[0]!.s as string;
    expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(await fails("ownerA", "select secret from public.webhook_endpoints")).toMatch(/permission denied/);
    expect(await as("managerA", (c) => c.q("select id from public.webhook_endpoints"))).toHaveLength(0);
    expect(await as("ownerB", (c) => c.q("select id from public.webhook_endpoints"))).toHaveLength(0);
  });

  test("events are written with the business change, only for subscribed types, and roll back with it", async () => {
    await admin("delete from public.webhook_deliveries");
    await as("ownerA", async (c) => {
      const so = (await c.q<Row>("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["SVC-1"], qty: 1 }])]))[0]!.id;
      expect(await c.q("select 1 from public.webhook_deliveries")).toHaveLength(0); // draft emits nothing
      await c.q("select * from public.confirm_sales_order($1)", [so]);
      const ev = await c.q<Row>("select event_type, payload from public.webhook_deliveries");
      expect(ev.map((e) => e.event_type)).toEqual(["sales_order.confirmed"]);
      expect(ev[0]!.payload.data.total_paise).toBe(590000);
      const line = (await c.q<Row>("select id from public.sales_order_lines where order_id=$1", [so]))[0]!.id;
      await c.q("select public.dispatch_order($1,$2)", [so, JSON.stringify([{ so_line_id: line, qty: 1 }])]); // dispatch.created not subscribed
      await c.q("select public.invoice_order($1)", [so]);
      const types = (await c.q<Row>("select event_type from public.webhook_deliveries order by created_at")).map((r) => r.event_type);
      expect(types).toEqual(["sales_order.confirmed", "invoice.created"]);
      const inv = (await c.q<Row>("select payload->'data' d from public.webhook_deliveries where event_type='invoice.created'"))[0]!.d;
      expect(inv.total_paise).toBe(590000);
    }); // rolled back
    expect(await admin("select 1 from public.webhook_deliveries")).toHaveLength(0);
  });

  test("claiming is exclusive, retries back off, success and exhaustion are final, a dead delivery can be retried", async () => {
    await admin("delete from public.webhook_deliveries");
    await as("ownerA", async (c) => {
      const so = (await c.q<Row>("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["SVC-1"], qty: 1 }])]))[0]!.id;
      await c.q("select * from public.confirm_sales_order($1)", [so]);
    }, true);
    expect(await fails("ownerA", "select * from public.claim_webhook_deliveries(10)")).toMatch(/permission denied/);
    const [first] = await svc((q) => q("select * from public.claim_webhook_deliveries(10)"));
    expect(first!.attempts).toBe(1);
    expect(first!.secret).toMatch(/^whsec_/);
    expect(await svc((q) => q("select * from public.claim_webhook_deliveries(10)"))).toHaveLength(0); // hidden while in flight
    await svc((q) => q("select public.record_webhook_result($1,false,503,'upstream down')", [first!.id]));
    const d1 = (await admin<Row>("select status, attempts, last_status, next_attempt_at > now() as later from public.webhook_deliveries where id=$1", [first!.id]))[0]!;
    expect(d1).toMatchObject({ status: "pending", attempts: 1, last_status: 503, later: true });
    for (let i = 2; i <= 8; i++) {
      await admin("update public.webhook_deliveries set next_attempt_at = now() where id=$1", [first!.id]);
      const [c] = await svc((q) => q("select * from public.claim_webhook_deliveries(10)"));
      expect(c!.attempts).toBe(i);
      await svc((q) => q("select public.record_webhook_result($1,false,500,'boom')", [first!.id]));
    }
    expect((await admin<Row>("select status from public.webhook_deliveries where id=$1", [first!.id]))[0]!.status).toBe("dead");
    await as("ownerA", (c) => c.q("select public.retry_webhook_delivery($1)", [first!.id]), true);
    await admin("update public.webhook_deliveries set next_attempt_at = now() where id=$1", [first!.id]);
    const [again] = await svc((q) => q("select * from public.claim_webhook_deliveries(10)"));
    expect(again!.attempts).toBe(1);
    await svc((q) => q("select public.record_webhook_result($1,true,200,null)", [first!.id]));
    expect((await admin<Row>("select status, delivered_at is not null d from public.webhook_deliveries where id=$1", [first!.id]))[0]).toMatchObject({ status: "delivered", d: true });
    await svc((q) => q("select public.record_webhook_result($1,false,500,'late')", [first!.id])); // stale result is ignored
    expect((await admin<Row>("select status from public.webhook_deliveries where id=$1", [first!.id]))[0]!.status).toBe("delivered");
    expect(await fails("ownerA", "select public.retry_webhook_delivery($1)", [first!.id])).toMatch(/only a failed/);
  });

  test("disabled endpoints stop receiving; other tenants never receive our events", async () => {
    await admin("delete from public.webhook_deliveries");
    const ep = (await admin<Row>("select id from public.webhook_endpoints where tenant_id=$1", [TENANT.A]))[0]!.id;
    await as("ownerA", (c) => c.q("select public.set_webhook_active($1,false)", [ep]), true);
    await as("ownerA", async (c) => {
      const so = (await c.q<Row>("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["SVC-1"], qty: 1 }])]))[0]!.id;
      await c.q("select * from public.confirm_sales_order($1)", [so]);
      expect(await c.q("select 1 from public.webhook_deliveries")).toHaveLength(0);
    });
    await as("ownerA", (c) => c.q("select public.set_webhook_active($1,true)", [ep]), true);
    expect(await as("ownerB", (c) => c.q("select 1 from public.webhook_deliveries"))).toHaveLength(0);
  });
});
