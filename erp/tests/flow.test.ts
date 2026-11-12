import { describe, it, expect, afterAll } from "vitest";
import { makeCompany, seedCatalog, T, addUser } from "./helpers";
import { resolveLines } from "@/lib/erp/lines";
import { createOrderRaw, confirmOrder, amendOrder, cancelOrder, shortageLines, creditExposure } from "@/lib/erp/sales";
import { requestForShortage, submitPR, convertPR, submitPO, receiveGoods, recordBill, paySupplierBill, returnToSupplier } from "@/lib/erp/procurement";
import { dispatchOrder, requestReturn, inspectReturn } from "@/lib/erp/fulfilment";
import { invoiceOrder, recordReceipt, reverseReceipt, trialBalance, reconciliation, closePeriod } from "@/lib/erp/finance";
import { decide } from "@/lib/erp/approvals";
import { reverseJournal, postJournal, today } from "@/lib/erp/ledger";
import { moveStock } from "@/lib/erp/inventory";
import { pool } from "@/lib/db";

afterAll(() => pool.end());
const sale = (co: any, item: string, qty: string, cust: string) => T(co, (db) => resolveLines(db, co.tenantId, [{ itemId: item, qty }], { kind: "sale", customerId: cust }));

describe("order to cash with procurement", () => {
  it("sale → reservation → shortage → purchase → partial receipt → dispatch → invoice → partial collection reconciles", async () => {
    const co = await makeCompany();
    const { item, cust, sup } = await seedCatalog(co);
    // 4 units on hand via opening receipt
    await T(co, async (db) => {
      await db.query("insert into goods_receipts(tenant_id,number,order_id,warehouse_id) select $1,'X',null,$2 where false", [co.tenantId, co.warehouseId]).catch(() => {});
      await moveStock(db, { tenantId: co.tenantId, userId: co.userId, itemId: item, warehouseId: co.warehouseId, delta: 4000, kind: "opening", unitCost: 6000, docType: "opening", docId: co.tenantId, docLineId: item });
      await db.query("update items set avg_cost_paise=6000 where id=$1", [item]);
      await postJournal(db, { tenantId: co.tenantId, userId: co.userId, date: today(), memo: "opening stock", lines: [{ account: "inventory", debit: 24000 }, { account: "equity", credit: 24000 }] });
    });
    // order 10 → 4 reserved, 6 short
    const lines = await sale(co, item, "10", cust);
    const so = await T(co, async (db) => { const o = await createOrderRaw(db, co.ctx, { customerId: cust, branchId: co.branchId, warehouseId: co.warehouseId, lines }); const r = await confirmOrder(db, co.ctx, o.id); return { o, r }; });
    expect(so.r.status).toBe("confirmed");
    expect(so.r.shortages[0].short).toBe(6000);
    // shortage → PR → approve → PO
    const sh = await T(co, (db) => shortageLines(db, co.tenantId, so.o.id));
    expect(sh).toHaveLength(1);
    const pr = await T(co, async (db) => {
      const p = await requestForShortage(db, co.ctx, so.o.id);
      await db.query("update purchase_request_lines set supplier_id=$2 where request_id=$1", [p.id, sup]);
      await submitPR(db, co.ctx, p.id); return p;
    });
    await expect(T(co, (db) => requestForShortage(db, co.ctx, so.o.id))).rejects.toThrow(/already covered/);
    const pos = await T(co, (db) => convertPR(db, co.ctx, pr.id, co.warehouseId));
    expect(pos).toHaveLength(1);
    await T(co, (db) => submitPO(db, co.ctx, pos[0].id));
    // partial receipt of 2
    const poLine = (await T(co, (db) => db.query("select id from purchase_order_lines where order_id=$1", [pos[0].id]))).rows[0].id;
    await T(co, (db) => receiveGoods(db, co.ctx, pos[0].id, [{ poLineId: poLine, qty: 2000 }]));
    await expect(T(co, (db) => receiveGoods(db, co.ctx, pos[0].id, [{ poLineId: poLine, qty: 5000 }]))).rejects.toThrow(/outstanding/);
    // auto-allocated: reserved now 6 of 10
    const l1 = (await T(co, (db) => db.query("select reserved_qty from sales_order_lines where order_id=$1", [so.o.id]))).rows[0];
    expect(l1.reserved_qty).toBe(6000);
    // dispatch 6, invoice 6, collect part
    const lineId = (await T(co, (db) => db.query("select id from sales_order_lines where order_id=$1", [so.o.id]))).rows[0].id;
    await T(co, (db) => dispatchOrder(db, co.ctx, so.o.id, [{ lineId, qty: 6000 }], "BlueDart", "TRK1"));
    await expect(T(co, (db) => dispatchOrder(db, co.ctx, so.o.id, [{ lineId, qty: 1000 }]))).rejects.toThrow(/reserved/);
    const inv = await T(co, (db) => invoiceOrder(db, co.ctx, so.o.id, [{ lineId, qty: 6000 }]));
    expect(inv.total).toBe(Math.round(6 * 10000 * 1.18));
    await expect(T(co, (db) => invoiceOrder(db, co.ctx, so.o.id, [{ lineId, qty: 1000 }]))).rejects.toThrow(/only 0 can be invoiced/);
    const rc = await T(co, async (db) => { const invId = (await db.query("select id from invoices where order_id=$1", [so.o.id])).rows[0].id; return recordReceipt(db, co.ctx, { customerId: cust, amount: 30000, method: "bank", receivedOn: today(), allocations: [{ invoiceId: invId, amount: 30000 }] }); });
    const invRow = (await T(co, (db) => db.query("select * from invoices where order_id=$1", [so.o.id]))).rows[0];
    expect(invRow.paid_paise).toBe(30000); expect(invRow.status).toBe("partially_paid");
    // over-allocation refused
    await expect(T(co, (db) => recordReceipt(db, co.ctx, { customerId: cust, amount: 999999, method: "bank", receivedOn: today(), allocations: [{ invoiceId: invRow.id, amount: 999999 }] }))).rejects.toThrow(/outstanding/);
    // reconcile
    const rec = await T(co, (db) => reconciliation(db, co.tenantId));
    for (const r of rec) expect(r.diff, r.check).toBe(0);
    const tb = await T(co, (db) => trialBalance(db, co.tenantId, today()));
    expect(tb.reduce((s, r) => s + Number(r.debit), 0)).toBe(tb.reduce((s, r) => s + Number(r.credit), 0));
    // reversing the receipt restores the invoice
    await T(co, (db) => reverseReceipt(db, co.ctx, rc.id, "wrong bank entry"));
    expect((await T(co, (db) => db.query("select paid_paise,status from invoices where id=$1", [invRow.id]))).rows[0]).toMatchObject({ paid_paise: 0, status: "posted" });
    for (const r of await T(co, (db) => reconciliation(db, co.tenantId))) expect(r.diff, r.check).toBe(0);
  });

  it("simultaneous reservations never over-reserve", async () => {
    const co = await makeCompany(); const { item, cust } = await seedCatalog(co);
    await T(co, (db) => moveStock(db, { tenantId: co.tenantId, userId: co.userId, itemId: item, warehouseId: co.warehouseId, delta: 5000, kind: "opening", unitCost: 6000, docType: "opening", docId: co.tenantId, docLineId: item }));
    const mk = async () => { const lines = await sale(co, item, "4", cust); return T(co, async (db) => { const o = await createOrderRaw(db, co.ctx, { customerId: cust, branchId: co.branchId, warehouseId: co.warehouseId, lines }); return o.id; }); };
    const ids = await Promise.all([mk(), mk(), mk()]);
    const res = await Promise.all(ids.map((id) => T(co, (db) => confirmOrder(db, co.ctx, id))));
    const reserved = (await T(co, (db) => db.query("select reserved, on_hand from stock_balances where item_id=$1", [item]))).rows[0];
    expect(reserved.reserved).toBeLessThanOrEqual(reserved.on_hand);
    expect(reserved.reserved).toBe(5000);
    expect(res.filter((r) => r.shortages.length === 0)).toHaveLength(1);
  });

  it("credit hold needs an authorised override with a reason; fulfilled orders cannot be amended", async () => {
    const co = await makeCompany(); const { item, cust } = await seedCatalog(co, { creditLimit: 5000 });
    await T(co, (db) => moveStock(db, { tenantId: co.tenantId, userId: co.userId, itemId: item, warehouseId: co.warehouseId, delta: 10000, kind: "opening", unitCost: 6000, docType: "opening", docId: co.tenantId, docLineId: item }));
    const lines = await sale(co, item, "2", cust);
    const o = await T(co, (db) => createOrderRaw(db, co.ctx, { customerId: cust, branchId: co.branchId, warehouseId: co.warehouseId, lines }));
    expect((await T(co, (db) => confirmOrder(db, co.ctx, o.id))).status).toBe("credit_hold");
    const clerk = await addUser(co, "sales");
    await expect(T(co, (db) => confirmOrder(db, clerk.ctx, o.id, { reason: "customer is good for it" }))).rejects.toThrow(/authorised/);
    await expect(T(co, (db) => confirmOrder(db, co.ctx, o.id, { reason: "x" }))).rejects.toThrow(/reason/);
    expect((await T(co, (db) => confirmOrder(db, co.ctx, o.id, { reason: "Approved by director call" }))).status).toBe("confirmed");
    const lineId = (await T(co, (db) => db.query("select id from sales_order_lines where order_id=$1", [o.id]))).rows[0].id;
    await T(co, (db) => dispatchOrder(db, co.ctx, o.id, [{ lineId, qty: 2000 }]));
    const v = (await T(co, (db) => db.query("select row_version from sales_orders where id=$1", [o.id]))).rows[0].row_version;
    await expect(T(co, (db) => amendOrder(db, co.ctx, o.id, v, [{ lineId, newQtyBase: 1000 }], "customer wants less"))).rejects.toThrow(/already dispatched|cannot be amended/);
    await expect(T(co, (db) => amendOrder(db, co.ctx, o.id, v + 5, [{ lineId, newQtyBase: 5000 }], "stale version here"))).rejects.toThrow(/changed by someone else|cannot be amended/);
  });

  it("returns restock once, credit follows invoicing, cancel releases reservation", async () => {
    const co = await makeCompany(); const { item, cust } = await seedCatalog(co);
    await T(co, async (db) => { await moveStock(db, { tenantId: co.tenantId, userId: co.userId, itemId: item, warehouseId: co.warehouseId, delta: 10000, kind: "opening", unitCost: 6000, docType: "opening", docId: co.tenantId, docLineId: item });
      await db.query("update items set avg_cost_paise=6000 where id=$1", [item]);
      await postJournal(db, { tenantId: co.tenantId, userId: co.userId, date: today(), memo: "open", lines: [{ account: "inventory", debit: 60000 }, { account: "equity", credit: 60000 }] }); });
    const lines = await sale(co, item, "5", cust);
    const o = await T(co, async (db) => { const o = await createOrderRaw(db, co.ctx, { customerId: cust, branchId: co.branchId, warehouseId: co.warehouseId, lines }); await confirmOrder(db, co.ctx, o.id); return o; });
    const lineId = (await T(co, (db) => db.query("select id from sales_order_lines where order_id=$1", [o.id]))).rows[0].id;
    await T(co, (db) => dispatchOrder(db, co.ctx, o.id, [{ lineId, qty: 5000 }]));
    await T(co, (db) => invoiceOrder(db, co.ctx, o.id, [{ lineId, qty: 5000 }]));
    const ret = await T(co, (db) => requestReturn(db, co.ctx, lineId, 2000, "damaged in transit"));
    await expect(T(co, (db) => requestReturn(db, co.ctx, lineId, 4000, "too many"))).rejects.toThrow(/Only 3 can still/);
    await T(co, (db) => inspectReturn(db, co.ctx, ret.id, "restock", "boxes intact"));
    await expect(T(co, (db) => inspectReturn(db, co.ctx, ret.id, "restock", "again"))).rejects.toThrow(/already closed/);
    const bal = (await T(co, (db) => db.query("select on_hand from stock_balances where item_id=$1", [item]))).rows[0].on_hand;
    expect(bal).toBe(5000 + 2000);
    const cn = (await T(co, (db) => db.query("select * from credit_notes")) ).rows[0];
    expect(cn.net_paise + cn.tax_paise).toBe(Math.round(2 * 10000 * 1.18));
    for (const r of await T(co, (db) => reconciliation(db, co.tenantId))) expect(r.diff, r.check).toBe(0);
    // a cancelled order frees reservations
    const l2 = await sale(co, item, "3", cust);
    const o2 = await T(co, async (db) => { const x = await createOrderRaw(db, co.ctx, { customerId: cust, branchId: co.branchId, warehouseId: co.warehouseId, lines: l2 }); await confirmOrder(db, co.ctx, x.id); return x; });
    expect((await T(co, (db) => db.query("select reserved from stock_balances where item_id=$1", [item]))).rows[0].reserved).toBe(3000);
    await T(co, (db) => cancelOrder(db, co.ctx, o2.id, "customer changed mind"));
    expect((await T(co, (db) => db.query("select reserved from stock_balances where item_id=$1", [item]))).rows[0].reserved).toBe(0);
  });

  it("bill matching: tolerance, exceptions need approval, duplicate supplier invoice refused", async () => {
    const co = await makeCompany(); const { item, sup } = await seedCatalog(co);
    const mgr = await addUser(co, "manager");
    const rl = await T(co, (db) => resolveLines(db, co.tenantId, [{ itemId: item, qty: "10" }], { kind: "purchase" }));
    const { createPO } = await import("@/lib/erp/procurement");
    const po = await T(co, async (db) => { const p = await createPO(db, co.ctx, { supplierId: sup, branchId: co.branchId, warehouseId: co.warehouseId, lines: rl }); await submitPO(db, co.ctx, p.id); return p; });
    const pol = (await T(co, (db) => db.query("select id from purchase_order_lines where order_id=$1", [po.id]))).rows[0].id;
    await T(co, (db) => receiveGoods(db, co.ctx, po.id, [{ poLineId: pol, qty: 10000 }]));
    const ok = await T(co, (db) => recordBill(db, co.ctx, { orderId: po.id, supplierRef: "INV-1", billDate: today(), lines: [{ poLineId: pol, qty: 4000, unitCostPaise: 6050 }] }));
    expect(ok.exception).toBe(false);
    await expect(T(co, (db) => recordBill(db, co.ctx, { orderId: po.id, supplierRef: "INV-1", billDate: today(), lines: [{ poLineId: pol, qty: 1000, unitCostPaise: 6000 }] }))).rejects.toThrow(/already recorded/);
    const bad = await T(co, (db) => recordBill(db, co.ctx, { orderId: po.id, supplierRef: "INV-2", billDate: today(), lines: [{ poLineId: pol, qty: 6000, unitCostPaise: 7500 }] }));
    expect(bad.exception).toBe(true);
    const reqRow = (await T(co, (db) => db.query("select id from approval_requests where entity_id=$1", [bad.id]))).rows[0];
    await expect(T(co, (db) => decide(db, co.ctx, reqRow.id, true, ""))).rejects.toThrow(/own request/);
    await T(co, (db) => decide(db, mgr.ctx, reqRow.id, true, "Price change agreed by phone"));
    expect((await T(co, (db) => db.query("select status, match_status from supplier_bills where id=$1", [bad.id]))).rows[0]).toMatchObject({ status: "posted", match_status: "exception_approved" });
    await T(co, (db) => paySupplierBill(db, co.ctx, ok.id, 1000, "bank", "UTR1", today()));
    await expect(T(co, (db) => paySupplierBill(db, co.ctx, ok.id, 99999999, "bank", "", today()))).rejects.toThrow(/balance due/);
    for (const r of await T(co, (db) => reconciliation(db, co.tenantId))) expect(r.diff, r.check).toBe(0);
  });

  it("journals: unbalanced rejected by the database, closed periods locked, reversal preserves trace", async () => {
    const co = await makeCompany();
    // raw SQL bypassing application checks still cannot post an unbalanced journal
    await expect(T(co, async (db) => {
      const a = (await db.query("select id from accounts where tenant_id=$1 and code='1000'", [co.tenantId])).rows[0].id;
      const b = (await db.query("select id from accounts where tenant_id=$1 and code='4000'", [co.tenantId])).rows[0].id;
      const j = (await db.query("insert into journals(tenant_id,number,entry_date,status) values ($1,'JX',current_date,'draft') returning id", [co.tenantId])).rows[0].id;
      await db.query("insert into journal_lines(tenant_id,journal_id,account_id,debit_paise) values ($1,$2,$3,100)", [co.tenantId, j, a]);
      await db.query("insert into journal_lines(tenant_id,journal_id,account_id,credit_paise) values ($1,$2,$3,90)", [co.tenantId, j, b]);
      await db.query("update journals set status='posted' where id=$1", [j]);
    })).rejects.toThrow(/not balanced/);
    const j = await T(co, (db) => postJournal(db, { tenantId: co.tenantId, userId: co.userId, date: today(), memo: "x", lines: [{ account: "cash", debit: 500 }, { account: "equity", credit: 500 }] }));
    await expect(T(co, (db) => db.query("update journal_lines set debit_paise=1 where journal_id=$1 and debit_paise>0", [j]))).rejects.toThrow(/cannot be changed/);
    await expect(T(co, (db) => db.query("delete from journals where id=$1", [j]))).rejects.toThrow(/reverse/);
    await expect(T(co, (db) => reverseJournal(db, co.tenantId, co.userId, j, "", today()))).rejects.toThrow(/reason/);
    const r = await T(co, (db) => reverseJournal(db, co.tenantId, co.userId, j, "posted by mistake", today()));
    expect(r).toBeTruthy();
    await expect(T(co, (db) => reverseJournal(db, co.tenantId, co.userId, j, "twice", today()))).rejects.toThrow();
    // close the current period: new postings in it fail
    const p = (await T(co, (db) => db.query("select id from fin_periods where tenant_id=$1 and current_date between starts_on and ends_on", [co.tenantId]))).rows[0].id;
    await T(co, async (db) => { await db.query("update fin_periods set status='closed' where tenant_id=$1 and ends_on < (select starts_on from fin_periods where id=$2)", [co.tenantId, p]); await closePeriod(db, co.ctx, p); });
    await expect(T(co, (db) => postJournal(db, { tenantId: co.tenantId, userId: co.userId, date: today(), memo: "late", lines: [{ account: "cash", debit: 1 }, { account: "equity", credit: 1 }] }))).rejects.toThrow(/closed/);
  });

  it("stock movements are immutable and duplicate postings are rejected", async () => {
    const co = await makeCompany(); const { item } = await seedCatalog(co);
    const mv = { tenantId: co.tenantId, userId: co.userId, itemId: item, warehouseId: co.warehouseId, delta: 1000, kind: "receipt" as const, unitCost: 1, docType: "goods_receipt", docId: co.tenantId, docLineId: item };
    await T(co, (db) => moveStock(db, mv));
    await expect(T(co, (db) => moveStock(db, mv))).rejects.toThrow();
    await expect(T(co, (db) => db.query("update stock_movements set qty_delta=5"))).rejects.toThrow(/append-only|permission denied/);
    await expect(T(co, (db) => db.query("delete from stock_movements"))).rejects.toThrow(/append-only|permission denied/);
    await expect(T(co, (db) => moveStock(db, { ...mv, delta: -5000, kind: "adjustment", docLineId: null }))).rejects.toThrow(/Not enough stock/);
  });
});
void creditExposure; void returnToSupplier;
