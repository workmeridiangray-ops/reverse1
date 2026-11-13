import { beforeAll, describe, expect, it } from "vitest";
import { type World, seedCompany, inCo } from "./helpers";
import * as x from "@/lib/server/svc/extras";
import * as proc from "@/lib/server/svc/procurement";
import * as inv from "@/lib/server/svc/inventory";
import { addDays, iso } from "@/lib/domain/dates";

let W: World; const due = addDays(iso(new Date()), 20);
beforeAll(async () => { W = await seedCompany("extras"); });

describe("purchase request → RFQ → comparison → award", () => {
  it("runs the sourcing flow and ends in a draft PO that still needs approval", async () => {
    const buyer = W.ctx("buyer", W.user2);
    await expect(inCo(W, (c) => x.createPR(c, buyer, W.items.PUMP!, 5, due, ""))).rejects.toThrow(/made on a work order/);
    const n = await inCo(W, (c) => x.createPR(c, buyer, W.items.BOLT!, 200, due, "Line stoppage risk")); expect(n).toMatch(/^PR-/);
    const pr = await inCo(W, async (c) => (await c.query("select id from purchase_requests")).rows[0].id);
    await expect(inCo(W, (c) => x.decidePR(c, buyer, pr, true, ""))).rejects.toThrow(/not allowed/);
    const rfq = await inCo(W, (c) => x.openRfq(c, buyer, pr));
    const s2 = await inCo(W, async (c) => (await c.query("insert into suppliers(company_id,code,name) values ($1,'S2','Bolt House') returning id", [W.companyId])).rows[0].id);
    await inCo(W, async (c) => { await x.addQuote(c, buyer, rfq, W.supplierId, 120, 7, ""); await x.addQuote(c, buyer, rfq, s2, 95, 12, "bulk"); });
    const quotes = await inCo(W, async (c) => (await c.query("select id, supplier_id, unit_price_paise from rfq_quotes order by unit_price_paise")).rows);
    expect(Number(quotes[0].unit_price_paise)).toBe(95);
    const po = await inCo(W, (c) => x.awardRfq(c, buyer, rfq, quotes[0].id));
    const row = await inCo(W, async (c) => (await c.query("select p.status, l.unit_price_paise from purchase_orders p join purchase_order_lines l on l.po_id=p.id where p.id=$1", [po.id])).rows[0]);
    expect(row.status).toBe("draft"); expect(Number(row.unit_price_paise)).toBe(95);
    await expect(inCo(W, (c) => x.awardRfq(c, buyer, rfq, quotes[1].id))).rejects.toThrow(/already closed/);
    expect(await inCo(W, async (c) => (await c.query("select status from purchase_requests where id=$1", [pr])).rows[0].status)).toBe("converted");
    void proc;
  });
});
describe("inspection plans", () => {
  it("copy limits onto auto-created inspections so out-of-limit values cannot pass", async () => {
    await inCo(W, (c) => x.savePlan(c, W.ctx(), { itemId: W.items.CASTING!, kind: "incoming", characteristic: "Bore diameter", unit: "mm", min: 49.9, max: 50.1 }));
    await expect(inCo(W, (c) => x.savePlan(c, W.ctx(), { itemId: W.items.CASTING!, kind: "incoming", characteristic: "Bad", min: 5, max: 1 }))).rejects.toThrow(/exceed/);
    const po = await inCo(W, async (c) => { const p = await proc.createPO(c, W.ctx(), W.supplierId, [{ itemId: W.items.CASTING!, qty: 10, price: 100, dueDate: due }]); await c.query("update purchase_orders set status='approved' where id=$1", [p.id]); return p; });
    const line = await inCo(W, async (c) => (await c.query("select id from purchase_order_lines where po_id=$1", [po.id])).rows[0].id);
    await inCo(W, (c) => proc.receive(c, W.ctx(), po.id, [{ lineId: line, qty: 10, batchCode: "PLAN-1" }], "I-1", W.stockLoc));
    const q = await inCo(W, async (c) => (await c.query("select characteristic, unit, min_value, max_value from inspections where kind='incoming' order by created_at desc limit 1")).rows[0]);
    expect(q.characteristic).toBe("Bore diameter"); expect(Number(q.min_value)).toBe(49.9); expect(q.unit).toBe("mm");
  });
});
describe("order amendment", () => {
  it("amends a confirmed line, lists affected jobs, refuses going below shipped quantity", async () => {
    const line = await inCo(W, async (c) => { const so = await c.query("insert into sales_orders(company_id,number,customer_id,status) values ($1,'SO-A',$2,'confirmed') returning id", [W.companyId, W.customerId]);
      const l = (await c.query("insert into sales_order_lines(company_id,order_id,line_no,item_id,qty,shipped_qty,due_date) values ($1,$2,1,$3,10,4,$4) returning id", [W.companyId, so.rows[0].id, W.items.PUMP, due])).rows[0].id;
      await c.query("insert into work_orders(company_id,number,item_id,plant_id,qty,due_date,so_line_id,status) values ($1,'WO-AM',$2,$3,10,$4,$5,'released')", [W.companyId, W.items.PUMP, W.plantId, due, l]); return l; });
    await expect(inCo(W, (c) => x.amendLine(c, W.ctx(), line, 3, due, "less"))).rejects.toThrow(/already shipped/);
    await expect(inCo(W, (c) => x.amendLine(c, W.ctx(), line, 12, due, ""))).rejects.toThrow(/reason/);
    const r = await inCo(W, (c) => x.amendLine(c, W.ctx(), line, 12, addDays(due, 5), "Customer asked for 2 more"));
    expect(r.jobs.map((j) => j.number)).toEqual(["WO-AM"]);
    expect(Number(await inCo(W, async (c) => (await c.query("select qty from sales_order_lines where id=$1", [line])).rows[0].qty))).toBe(12);
  });
});
describe("count sheets", () => {
  it("snapshots a location, requires every line counted, posts differences with reasons", async () => {
    await inCo(W, (c) => inv.post(c, W.ctx(), { itemId: W.items.ALT!, locationId: W.stockLoc, qty: 10, kind: "receipt" }));
    const n = await inCo(W, (c) => x.startCount(c, W.ctx(), W.stockLoc, "CNT-1")); expect(n).toBeGreaterThan(0);
    await expect(inCo(W, (c) => x.postCount(c, W.ctx(), "CNT-1", "year end"))).rejects.toThrow(/every line/);
    await inCo(W, (c) => c.query("update stock_counts set counted_qty = system_qty where sheet='CNT-1'"));
    await inCo(W, (c) => c.query("update stock_counts set counted_qty = 7 where sheet='CNT-1' and item_code='BOLT-ALT'"));
    const r = await inCo(W, (c) => x.postCount(c, W.ctx(), "CNT-1", "Year-end count")); expect(r.adjusted).toBe(1);
    expect(await inCo(W, (c) => inv.onHand(c, W.items.ALT!))).toBe(7);
    await expect(inCo(W, (c) => x.postCount(c, W.ctx("operator", W.user2), "CNT-1", ""))).rejects.toThrow(/not allowed|Nothing pending/);
  });
});
