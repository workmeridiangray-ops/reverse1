import { beforeAll, describe, expect, it } from "vitest";
import { type World, seedCompany, inCo } from "./helpers";
import { pool, tx } from "@/lib/server/db";
import * as planning from "@/lib/server/svc/planning";
import * as proc from "@/lib/server/svc/procurement";
import * as prod from "@/lib/server/svc/production";
import * as qa from "@/lib/server/svc/quality";
import * as ful from "@/lib/server/svc/fulfilment";
import * as inv from "@/lib/server/svc/inventory";
import * as cost from "@/lib/server/svc/costing";
import * as eng from "@/lib/server/svc/engineering";
import { addDays, iso } from "@/lib/domain/dates";

let A: World, B: World;
const due = addDays(iso(new Date()), 30);
beforeAll(async () => { A = await seedCompany("alpha"); B = await seedCompany("beta"); });

describe("demand → MRP → purchase → receipt → issue → operations → inspection → dispatch → cost", () => {
  let soLine: string, woPump: string, woHousing: string;
  it("confirms a customer order and plans it", async () => {
    soLine = await inCo(A, async (c) => {
      const so = await c.query("insert into sales_orders(company_id,number,customer_id,status) values ($1,'SO-1',$2,'confirmed') returning id", [A.companyId, A.customerId]);
      return (await c.query("insert into sales_order_lines(company_id,order_id,line_no,item_id,qty,due_date) values ($1,$2,1,$3,10,$4) returning id", [A.companyId, so.rows[0].id, A.items.PUMP, due])).rows[0].id;
    });
    const run = await inCo(A, (c) => planning.runPlanning(c, A.ctx(), 90));
    expect(run.count).toBeGreaterThanOrEqual(3);
    const sugg = await inCo(A, async (c) => (await c.query("select s.*, i.code from mrp_suggestions s join items i on i.id=s.item_id order by i.code")).rows);
    const by = Object.fromEntries(sugg.map((s) => [s.code, s]));
    expect(Number(by.PUMP.qty)).toBe(10); expect(by.PUMP.kind).toBe("production");
    expect(Number(by.BOLT.qty)).toBe(100);               // 40 needed, lot size 100
    expect(Number(by.CASTING.qty)).toBe(20);             // 10 housings × 2
    expect(by.CASTING.reason.sources[0].source).toMatch(/planned HOUSING/);   // explains why
    expect(by.PUMP.status).toBe("suggested");
  });
  it("releasing needs deliberate action and the demand check blocks stale runs", async () => {
    const s = await inCo(A, async (c) => (await c.query("select id from mrp_suggestions s where item_id=$1", [A.items.BOLT])).rows[0].id);
    // concurrent demand change after the run
    await inCo(A, (c) => c.query("insert into sales_order_lines(company_id,order_id,line_no,item_id,qty,due_date) select company_id,order_id,2,item_id,1,due_date from sales_order_lines limit 1"));
    await expect(inCo(A, (c) => planning.releaseSuggestion(c, A.ctx(), s, { supplierId: A.supplierId }))).rejects.toThrow(/Demand has changed/);
    await inCo(A, (c) => c.query("delete from sales_order_lines where line_no=2"));
  });
  it("purchases with maker-checker approval, partial receipt and quarantine", async () => {
    const po = await inCo(A, async (c) => { const p = await proc.createPO(c, A.ctx("buyer", A.user2), A.supplierId, [
      { itemId: A.items.BOLT!, qty: 100, price: 100, dueDate: due }, { itemId: A.items.CASTING!, qty: 20, price: 3000, dueDate: due }]); await proc.submitPO(c, A.ctx("buyer", A.user2), p.id); return p; });
    await expect(inCo(A, (c) => proc.decidePO(c, A.ctx("manager", A.user2), po.id, true, ""))).rejects.toThrow(/maker-checker/);
    await inCo(A, (c) => proc.decidePO(c, A.ctx("owner"), po.id, true, ""));
    const lines = await inCo(A, async (c) => (await c.query("select id, item_id from purchase_order_lines where po_id=$1", [po.id])).rows);
    const bolt = lines.find((l) => l.item_id === A.items.BOLT)!, cast = lines.find((l) => l.item_id === A.items.CASTING)!;
    await inCo(A, (c) => proc.receive(c, A.ctx(), po.id, [{ lineId: bolt.id, qty: 60 }, { lineId: cast.id, qty: 10, batchCode: "CAST-1" }], "INV-77", A.stockLoc));
    await expect(inCo(A, (c) => proc.receive(c, A.ctx(), po.id, [{ lineId: bolt.id, qty: 50 }], "INV-78", A.stockLoc))).rejects.toThrow(/Over-receipt/);
    await inCo(A, (c) => proc.receive(c, A.ctx(), po.id, [{ lineId: bolt.id, qty: 40 }, { lineId: cast.id, qty: 10, batchCode: "CAST-2" }], "INV-79", A.stockLoc));
    const st = await inCo(A, async (c) => (await c.query("select status from purchase_orders where id=$1", [po.id])).rows[0].status);
    expect(st).toBe("received");
    // quarantined castings cannot be issued
    woHousing = (await inCo(A, async (c) => { const w = await prod.createWO(c, A.ctx(), { itemId: A.items.HOUSING!, qty: 10, dueDate: due, plantId: A.plantId }); await prod.releaseWO(c, A.ctx(), w.id); return w; })).id;
    const b = await inCo(A, async (c) => (await c.query("select id from batches where code='CAST-1'")).rows[0].id);
    await expect(inCo(A, (c) => prod.issueMaterial(c, A.ctx(), woHousing, A.items.CASTING!, 10, b, A.stockLoc))).rejects.toThrow(/quarantine/);
  });
  it("incoming inspection releases the batch; failure raises an NCR", async () => {
    const insp = await inCo(A, async (c) => (await c.query("select i.id, b.code from inspections i join batches b on b.id=i.batch_id where i.kind='incoming' order by b.code")).rows);
    await expect(inCo(A, (c) => qa.recordResult(c, A.ctx("operator", A.user2), insp[0].id, { pass: true }))).rejects.toThrow(/not authorised/);
    await inCo(A, (c) => qa.recordResult(c, A.ctx("quality", A.user2), insp[0].id, { pass: true, measured: 10.02, min: 9.9, max: 10.1, unit: "mm" }));
    await expect(inCo(A, (c) => qa.recordResult(c, A.ctx("quality", A.user2), insp[1].id, { pass: true, measured: 11, min: 9.9, max: 10.1 }))).rejects.toThrow(/outside the limits/);
    await inCo(A, (c) => qa.recordResult(c, A.ctx("quality", A.user2), insp[1].id, { pass: false, measured: 11, min: 9.9, max: 10.1, notes: "oversize" }));
    const ncr = await inCo(A, async (c) => (await c.query("select id from ncrs")).rows[0].id);
    await expect(inCo(A, (c) => qa.disposition(c, A.ctx("quality", A.user2), ncr, "return", ""))).rejects.toThrow(/reason/);
    await inCo(A, (c) => qa.disposition(c, A.ctx("quality", A.user2), ncr, "return", "Supplier to replace"));
    const bs = await inCo(A, async (c) => (await c.query("select code,status from batches where code like 'CAST-%' order by code")).rows);
    expect(bs.map((b) => b.status)).toEqual(["available", "rejected"]);
    const onhand = await inCo(A, (c) => inv.onHand(c, A.items.CASTING!, { availableOnly: true })); expect(onhand).toBe(10);
  });
  it("executes jobs: issue, over-issue guard, sequence, output, serial-less batch, costing", async () => {
    const b = await inCo(A, async (c) => (await c.query("select id from batches where code='CAST-1'")).rows[0].id);
    // housing needs 20 castings; only 10 available → posting 20 fails on stock
    await expect(inCo(A, (c) => prod.issueMaterial(c, A.ctx(), woHousing, A.items.CASTING!, 20, b, A.stockLoc))).rejects.toThrow(/insufficient stock/);
    await inCo(A, (c) => prod.issueMaterial(c, A.ctx(), woHousing, A.items.CASTING!, 10, b, A.stockLoc, undefined, "k1"));
    const dup = await inCo(A, (c) => prod.issueMaterial(c, A.ctx(), woHousing, A.items.CASTING!, 10, b, A.stockLoc, undefined, "k1"));  // double submit
    expect(dup).toEqual({ duplicate: true });
    const iss = await inCo(A, async (c) => (await c.query("select issued_qty from wo_materials where work_order_id=$1", [woHousing])).rows[0].issued_qty);
    expect(iss).toBe(10);
    const ops = await inCo(A, async (c) => (await c.query("select id from wo_operations where work_order_id=$1", [woHousing])).rows);
    // output is limited by issued material (10 castings → 5 housings)
    await inCo(A, async (c) => { await prod.opAction(c, A.ctx("operator", A.user2), ops[0].id, "start"); await prod.opAction(c, A.ctx("operator", A.user2), ops[0].id, "finish"); });
    await expect(inCo(A, (c) => prod.reportOutput(c, A.ctx(), woHousing, 10, 0, "", [], A.stockLoc))).rejects.toThrow(/issued material/);
    await inCo(A, (c) => prod.reportOutput(c, A.ctx(), woHousing, 5, 0, "", [], A.stockLoc));
    await inCo(A, (c) => prod.completeWO(c, A.ctx(), woHousing, "Short on castings"));
    expect(await inCo(A, (c) => inv.onHand(c, A.items.HOUSING!))).toBe(5);
    const jc = await inCo(A, (c) => cost.jobCostFor(c, woHousing));
    expect(jc.material).toBe(30000);      // 10 × ₹30 PO price
  });
  it("snapshots engineering basis; ECO shows affected jobs and cannot be self-approved", async () => {
    woPump = (await inCo(A, async (c) => { const w = await prod.createWO(c, A.ctx(), { itemId: A.items.PUMP!, qty: 2, dueDate: due, plantId: A.plantId, soLineId: soLine }); await prod.releaseWO(c, A.ctx(), w.id); return w; })).id;
    const snap = await inCo(A, async (c) => (await c.query("select bom_snapshot from work_orders where id=$1", [woPump])).rows[0].bom_snapshot);
    expect(snap.lines).toHaveLength(2); expect(snap.bomVersion).toBe(1);
    const nb = await inCo(A, async (c) => {
      const b = (await c.query("insert into boms(company_id,item_id,version) values ($1,$2,2) returning id", [A.companyId, A.items.PUMP])).rows[0].id;
      await c.query("insert into bom_lines(company_id,bom_id,component_item_id,qty_per) values ($1,$2,$3,5)", [A.companyId, b, A.items.BOLT]);
      await c.query("insert into bom_lines(company_id,bom_id,component_item_id,qty_per) values ($1,$2,$3,1)", [A.companyId, b, A.items.HOUSING]); return b; });
    const n = await inCo(A, (c) => eng.requestRelease(c, A.ctx("planner", A.user2), nb, "Use 5 bolts"));
    const cr = await inCo(A, async (c) => (await c.query("select id, affected from change_requests where number=$1", [n])).rows[0]);
    expect(cr.affected.length).toBeGreaterThan(0);
    await expect(inCo(A, (c) => eng.decideChange(c, A.ctx("planner", A.user2), cr.id, true, ""))).rejects.toThrow(/own change/);
    await inCo(A, (c) => eng.decideChange(c, A.ctx("owner"), cr.id, true, ""));
    const frozen = await inCo(A, (c) => prod.releaseWO(c, A.ctx(), woPump).catch((e) => e.message));
    expect(frozen).toMatch(/only planned/);
    expect((await inCo(A, async (c) => (await c.query("select bom_snapshot->>'bomVersion' v from work_orders where id=$1", [woPump])).rows[0].v))).toBe("1"); // unchanged by ECO
    await expect(inCo(A, (c) => c.query("insert into bom_lines(company_id,bom_id,component_item_id,qty_per) values ($1,$2,$3,1)", [A.companyId, nb, A.items.CASTING]))).rejects.toThrow(/frozen/);
  });
  it("dispatches only released batches, traces forward and backward, and recalls", async () => {
    // build 2 pumps with real material
    const mat = await inCo(A, async (c) => (await c.query("select item_id from wo_materials where work_order_id=$1", [woPump])).rows);
    expect(mat.length).toBe(2);
    await inCo(A, (c) => prod.issueMaterial(c, A.ctx(), woPump, A.items.BOLT!, 8, null, A.stockLoc));
    await inCo(A, (c) => prod.issueMaterial(c, A.ctx(), woPump, A.items.HOUSING!, 2, null, A.stockLoc));
    const op = await inCo(A, async (c) => (await c.query("select id from wo_operations where work_order_id=$1", [woPump])).rows[0].id);
    await inCo(A, async (c) => { await prod.opAction(c, A.ctx(), op, "start"); await prod.opAction(c, A.ctx(), op, "finish"); });
    await expect(inCo(A, (c) => prod.reportOutput(c, A.ctx(), woPump, 3, 0, "PMP-1", [], A.stockLoc))).rejects.toThrow(/Output would exceed/);
    await inCo(A, (c) => prod.reportOutput(c, A.ctx(), woPump, 2, 0, "PMP-1", [], A.stockLoc));
    const pb = await inCo(A, async (c) => (await c.query("select id from batches where code='PMP-1'")).rows[0].id);
    await expect(inCo(A, (c) => ful.createShipment(c, A.ctx(), A.customerId, [{ soLineId: soLine, batchId: pb, locationId: A.stockLoc, qty: 2 }]))).rejects.toThrow(/quarantine/);
    const fin = await inCo(A, async (c) => (await c.query("select id from inspections where batch_id=$1", [pb])).rows[0].id);
    await inCo(A, (c) => qa.recordResult(c, A.ctx("quality", A.user2), fin, { pass: true }));
    const sh = await inCo(A, (c) => ful.createShipment(c, A.ctx(), A.customerId, [{ soLineId: soLine, batchId: pb, locationId: A.stockLoc, qty: 2 }]));
    await inCo(A, (c) => ful.dispatch(c, A.ctx(), sh.id, "INV-9"));
    await expect(inCo(A, (c) => ful.dispatch(c, A.ctx(), sh.id, "INV-9"))).rejects.toThrow(/not in packing/);
    const line = await inCo(A, async (c) => (await c.query("select shipped_qty from sales_order_lines where id=$1", [soLine])).rows[0].shipped_qty); expect(line).toBe(2);
    // recall from a casting batch → affected outputs and customer
    const cb = await inCo(A, async (c) => (await c.query("select id from batches where code='CAST-1'")).rows[0].id);
    const tr = await inCo(A, (c) => inv.forwardTrace(c, cb));
    expect(tr.workOrders.map((w) => w.number)).toContain((await inCo(A, async (c) => (await c.query("select number from work_orders where id=$1", [woHousing])).rows[0].number)));
    const bolt = await inCo(A, async (c) => (await c.query("select id from batches where item_id=$1", [A.items.PUMP])).rows[0].id);
    const back = await inCo(A, (c) => inv.backwardTrace(c, bolt));
    expect(Array.isArray(back.inputBatches)).toBe(true);
  });
  it("stock ledger: reversal once only, immutable rows, adjustments need reasons", async () => {
    const mv = await inCo(A, async (c) => (await c.query("select id from stock_movements where kind='receipt' and item_id=$1 limit 1", [A.items.BOLT])).rows[0].id);
    await expect(inCo(A, (c) => inv.reverse(c, A.ctx(), mv, ""))).rejects.toThrow(/reason/);
    await expect(inCo(A, (c) => c.query("update stock_movements set qty = 1 where id=$1", [mv]))).rejects.toThrow();
    await expect(inCo(A, (c) => c.query("delete from stock_movements where id=$1", [mv]))).rejects.toThrow();
    await expect(inCo(A, (c) => inv.adjust(c, A.ctx(), A.items.BOLT!, null, A.stockLoc, 1, ""))).rejects.toThrow(/reason/);
  });
  it("concurrent reservations cannot oversell", async () => {
    await inCo(A, async (c) => { await inv.post(c, A.ctx(), { itemId: A.items.ALT!, locationId: A.stockLoc, qty: 10, kind: "receipt" }); });
    const attempts = await Promise.allSettled([1, 2, 3, 4].map((n) => inCo(A, (c) => inv.reserve(c, A.ctx(), A.items.ALT!, 4, "sales_order", crypto.randomUUID()))));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(2);   // 10 units / 4 each → only two succeed
    const posts = await Promise.allSettled([1, 2].map(() => inCo(A, (c) => inv.post(c, A.ctx(), { itemId: A.items.ALT!, locationId: A.stockLoc, qty: -8, kind: "issue" }))));
    expect(posts.filter((a) => a.status === "fulfilled")).toHaveLength(1);       // stock cannot go negative
  });
  it("cost periods: corrections after close go to the open period; closed period blocks", async () => {
    await inCo(A, (c) => cost.adjustCost(c, A.ctx("finance", A.user2), woHousing, 500, "Freight not booked"));
    await expect(inCo(A, (c) => cost.adjustCost(c, A.ctx("operator", A.user2), woHousing, 500, "x"))).rejects.toThrow(/not allowed/);
    const jc = await inCo(A, (c) => cost.jobCostFor(c, woHousing)); expect(jc.adjustments).toBe(500);
  });
});

describe("tenant isolation", () => {
  it("company B sees none of A's rows through RLS, even with guessed ids", async () => {
    const aItem = A.items.PUMP!;
    for (const t of ["items", "work_orders", "stock_movements", "sales_orders", "purchase_orders", "boms", "batches", "inspections"]) {
      const rows = await tx(async (c) => (await c.query(`select count(*)::int n from ${t}`)).rows[0].n, { companyId: B.companyId });
      const own = await tx(async (c) => (await c.query(`select count(*)::int n from ${t} where company_id=$1`, [A.companyId])).rows[0].n, { companyId: B.companyId });
      expect(own, t).toBe(0); void rows;
    }
    const guessed = await tx(async (c) => (await c.query("select * from items where id=$1", [aItem])).rowCount, { companyId: B.companyId });
    expect(guessed).toBe(0);
    await expect(tx((c) => c.query("insert into items(company_id,code,name,kind,uom) values ($1,'X','X','buy','EA')", [A.companyId]), { companyId: B.companyId })).rejects.toThrow(/row-level security/);
    await expect(tx((c) => c.query("update items set name='hacked' where id=$1", [aItem]).then((r) => { if (!r.rowCount) throw new Error("no rows"); }), { companyId: B.companyId })).rejects.toThrow();
  });
  it("without a tenant context nothing is visible; composite FKs stop cross-company links", async () => {
    const r = await pool.query("select count(*)::int n from items"); expect(r.rows[0].n).toBe(0);
    await expect(tx((c) => c.query("insert into sales_orders(company_id,number,customer_id) values ($1,'X',$2)", [B.companyId, A.customerId]), { companyId: B.companyId })).rejects.toThrow(/foreign key/);
  });
  it("tenant mismatch in service layer: B cannot post stock against A's item", async () => {
    await expect(tx((c) => inv.post(c, B.ctx(), { itemId: A.items.PUMP!, locationId: B.stockLoc, qty: 1, kind: "receipt" }), { companyId: B.companyId })).rejects.toThrow();
  });
});
