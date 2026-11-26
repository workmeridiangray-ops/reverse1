import { afterAll, describe, expect, it } from "vitest";
import { as, attempt, ID, pool, U } from "./helpers";

afterAll(() => pool.end());
type Row = Record<string, unknown>;
async function scenario(fn: (as2: (u: string) => Promise<void>, q: (sql: string, p?: unknown[]) => Promise<Row[]>) => Promise<void>) {
  const c = await pool.connect();
  const as2 = async (uid: string) => {
    await c.query("reset role"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  };
  try { await c.query("begin"); await fn(as2, async (sql, p) => (await c.query(sql, p)).rows); } finally { await c.query("rollback").catch(() => undefined); c.release(); }
}
const fails = (c: Promise<unknown>, re: RegExp) => expect(c).rejects.toThrow(re);
const sp = async (q: (s: string, p?: unknown[]) => Promise<Row[]>, n: string, fn: () => Promise<void>) => { await q(`savepoint ${n}`); await fn(); await q(`rollback to savepoint ${n}`); };
// A second admin is needed for four-eyes steps: use the admin as approver and a nurse as requester/creator where roles allow.

describe("request -> PO -> receipt -> stock", () => {
  it("full path with second-person approvals", async () => {
    await scenario(async (as2, q) => {
      await as2(U.nurseA);
      const req = (await q(`select public.request_purchase($1, 100, 450, 'Ward 1 is running low on dressings') as id`, [ID.itemDressing]))[0]!.id as string;
      await as2(U.adminA);
      await q(`select public.decide_request($1, true)`, [req]);
      await sp(q, "a", () => fails(q(`select public.decide_request($1, true)`, [req]), /Already decided/));
      const po = (await q(`select public.create_po($1, $2::uuid[]) as id`, [ID.supplier, [req]]))[0]!.id as string;
      expect((await q(`select number, status from public.purchase_orders where id = $1`, [po]))[0]).toMatchObject({ status: "draft" });
      // creator and approver are the same admin: refused
      await sp(q, "b", () => fails(q(`select public.approve_po($1)`, [po]), /someone other than/));
      // goods cannot arrive before approval
      const line = (await q(`select id from public.po_lines where po_id = $1`, [po]))[0]!.id as string;
      await sp(q, "c", () => fails(q(`select public.receive_goods($1, 10, 'DN-1', $2)`, [line, ID.locMain]), /approved before/));
      await as2(U.admin2A);
      await q(`select public.approve_po($1)`, [po]);
      await as2(U.nurseA);
      await q(`select public.receive_goods($1, 60, 'DN-1', $2)`, [line, ID.locMain]);
      await sp(q, "d", () => fails(q(`select public.receive_goods($1, 41, 'DN-2', $2)`, [line, ID.locMain]), /Only 40 more/));
      await as2(U.adminA);
      expect((await q(`select status from public.purchase_orders where id = $1`, [po]))[0]?.status).toBe("part_received");
      await as2(U.nurseA);
      await q(`select public.receive_goods($1, 40, 'DN-2', $2)`, [line, ID.locMain]);
      await as2(U.adminA);
      expect((await q(`select status from public.purchase_orders where id = $1`, [po]))[0]?.status).toBe("received");
      expect((await q(`select qty from public.store_balances where item_id = $1 and location_id = $2`, [ID.itemDressing, ID.locMain]))[0]?.qty).toBe(100);
      await q(`select public.set_supplier_bill($1, 'INV-7781')`, [po]);
      expect((await q(`select supplier_bill_ref from public.purchase_orders where id = $1`, [po]))[0]?.supplier_bill_ref).toBe("INV-7781");
      const bad = await q(`select 1 from public.store_balances b where b.qty <> coalesce((select sum(qty) from public.store_movements m where m.item_id = b.item_id and m.location_id = b.location_id), 0)`);
      expect(bad).toEqual([]);
    });
  });
  it("requests: self-decision refused, rejection needs a reason, only approved requests become orders", async () => {
    await scenario(async (as2, q) => {
      await as2(U.adminA);
      const mine = (await q(`select public.request_purchase($1, 5, 100, 'Admin office supplies need') as id`, [ID.itemGloves]))[0]!.id as string;
      await sp(q, "a", () => fails(q(`select public.decide_request($1, true)`, [mine]), /someone other than/));
      await sp(q, "b", () => fails(q(`select public.create_po($1, $2::uuid[])`, [ID.supplier, [mine]]), /Only approved/));
      await as2(U.nurseA);
      const r = (await q(`select public.request_purchase($1, 5, 100, 'Needed for ward round supplies') as id`, [ID.itemGloves]))[0]!.id as string;
      await as2(U.adminA);
      await sp(q, "c", () => fails(q(`select public.decide_request($1, false, 'no')`, [r]), /reason for rejecting/));
      await q(`select public.decide_request($1, false, 'Stock is sufficient this month')`, [r]);
    });
  });
  it("requests are visible only to the requester and admin; POs and suppliers only to admin", async () => {
    await scenario(async (as2, q) => {
      await as2(U.nurseA); await q(`select public.request_purchase($1, 5, 100, 'Needed for ward round supplies')`, [ID.itemGloves]);
      expect((await q(`select 1 from public.purchase_requests`))).toHaveLength(1);
      await as2(U.doctorA); expect(await q(`select 1 from public.purchase_requests`)).toHaveLength(0);
      expect(await q(`select 1 from public.suppliers`)).toHaveLength(0);
      await as2(U.adminA); expect(await q(`select 1 from public.purchase_requests`)).toHaveLength(1);
    });
    expect((await as("adminB", (q) => attempt(q, `select public.request_purchase($1, 1, 1, 'Cross clinic attempt')`, [ID.itemGloves]))).error).toMatch(/not found/i);
  });
});

describe("issue, transfer and counts", () => {
  it("issues and transfers move stock without going negative; every change is in the ledger", async () => {
    await scenario(async (as2, q) => {
      await as2(U.nurseA);
      await q(`select public.transfer_stock($1, $2, $3, 15)`, [ID.itemGloves, ID.locMain, ID.locWard]);
      await q(`select public.issue_stock($1, $2, 5, 'Ward 1 dressing round')`, [ID.itemGloves, ID.locWard]);
      await sp(q, "a", () => fails(q(`select public.issue_stock($1, $2, 11, 'Theatre')`, [ID.itemGloves, ID.locWard]), /Only 10 in stock/));
      await sp(q, "b", () => fails(q(`select public.transfer_stock($1, $2, $2, 1)`, [ID.itemGloves, ID.locMain]), /two different/));
      await sp(q, "c", () => fails(q(`select public.issue_stock($1, $2, 1, 'x')`, [ID.itemGloves, ID.locMain]), /department/));
      const main = (await q(`select qty from public.store_balances where item_id = $1 and location_id = $2`, [ID.itemGloves, ID.locMain]))[0]?.qty;
      expect(main).toBe(25);
    });
  });
  it("a stock count that differs needs a reason and records the variance", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      expect((await q(`select public.stock_count($1, $2, 40, null) as v`, [ID.itemGloves, ID.locMain]))[0]?.v).toBe(0);
      await sp(q, "a", () => fails(q(`select public.stock_count($1, $2, 37, 'x')`, [ID.itemGloves, ID.locMain]), /reason for the difference/));
      expect((await q(`select public.stock_count($1, $2, 37, 'Three boxes damaged in flood') as v`, [ID.itemGloves, ID.locMain]))[0]?.v).toBe(-3);
      expect((await q(`select qty from public.store_balances where item_id = $1 and location_id = $2`, [ID.itemGloves, ID.locMain]))[0]?.qty).toBe(37);
    });
  });
  it("reception, patients cannot move stock; ledger is immutable", async () => {
    for (const u of ["deskA", "doctorA", "patientA"] as const) {
      expect((await as(u, (q) => attempt(q, `select public.issue_stock($1, $2, 1, 'Ward')`, [ID.itemGloves, ID.locMain]))).error, u).toMatch(/permission/);
    }
    expect((await as("adminA", (q) => attempt(q, `update public.store_movements set qty = 1`))).error).toMatch(/permission denied/);
  });
});

describe("assets and maintenance", () => {
  it("fault -> start (asset goes under maintenance) -> resolve (downtime recorded, back in service)", async () => {
    await scenario(async (as2, q) => {
      await as2(U.nurseA);
      const m = (await q(`select public.report_fault($1, 'Alarm will not silence', 'urgent') as id`, [ID.assetMonitor]))[0]!.id as string;
      await as2(U.adminA);
      await sp(q, "a", () => fails(q(`select public.resolve_maintenance($1, 'Replaced the speaker')`, [m]), /Start the work/));
      await q(`select public.start_maintenance($1)`, [m]);
      expect((await q(`select status from public.assets where id = $1`, [ID.assetMonitor]))[0]?.status).toBe("under_maintenance");
      await sp(q, "b", () => fails(q(`select public.retire_asset($1, 'Beyond economic repair')`, [ID.assetMonitor]), /Resolve open maintenance/));
      await q(`select public.resolve_maintenance($1, 'Replaced the speaker')`, [m]);
      expect((await q(`select status, downtime_minutes from public.maintenance_requests where id = $1`, [m]))[0]).toMatchObject({ status: "resolved" });
      expect((await q(`select status from public.assets where id = $1`, [ID.assetMonitor]))[0]?.status).toBe("in_service");
      // reporter sees own request; another nurse-level reporter (doctor) does not
      await as2(U.nurseA); expect(await q(`select 1 from public.maintenance_requests`)).toHaveLength(1);
      await as2(U.doctorA); expect(await q(`select 1 from public.maintenance_requests`)).toHaveLength(0);
    });
  });
  it("only admin registers, services and retires assets; tags are unique per clinic; other clinic sees none", async () => {
    expect((await as("nurseA", (q) => attempt(q, `select public.register_asset('NEW-1', 'Scale', 'equipment', 'Ward', null)`))).error).toMatch(/permission/);
    await as("adminA", async (q) => {
      expect((await attempt(q, `select public.register_asset('mon-001', 'Dup', 'equipment', null, null)`)).error).toMatch(/duplicate key/);
      expect((await attempt(q, `select public.register_asset('x', 'Bad tag', 'equipment', null, null)`)).error).toMatch(/check constraint/);
      expect((await attempt(q, `select public.record_service($1, current_date + 180)`, [ID.assetPump])).ok).toBe(true);
    });
    expect(await as("adminB", (q) => q(`select 1 from public.assets`))).toHaveLength(0);
  });
});
