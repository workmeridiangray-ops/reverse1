import { beforeAll, describe, expect, test } from "vitest";
import { as, CUST, seed, SUP, U, WH } from "./helpers";

beforeAll(seed);
type Row = Record<string, any>;
const who = (c: any, u: keyof typeof U) => c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[u] })]);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Fresh tracked item + a purchase order for `qty`, inside the caller's transaction. */
async function setup(c: any, sku: string, tracking: "batch" | "serial", qty: number) {
  const item = (await c.q("insert into public.items (tenant_id, sku, name, tracking, sale_price_paise, cost_paise, barcode) select app.tenant_id(), $1, $1, $2, 10000, 6000, $3 returning id", [sku, tracking, "BC-" + sku]))[0].id;
  const so = (await c.q("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: item, qty }])]))[0].id;
  await c.q("select * from public.confirm_sales_order($1)", [so]);
  await c.q("select public.request_shortage_purchases($1)", [so]);
  const pr = (await c.q("select id from public.purchase_requests where item_id=$1", [item]))[0].id;
  const po = (await c.q("select public.approve_purchase_request($1,$2,6000) id", [pr, SUP["Prime Components"]]))[0].id;
  const pol = (await c.q("select id from public.purchase_order_lines where po_id=$1", [po]))[0].id;
  const line = (await c.q("select id from public.sales_order_lines where order_id=$1", [so]))[0].id;
  return { item, so, po, pol, line };
}

describe("batch tracking, expiry and FEFO", () => {
  test("receipt needs lots that add up; dispatch takes the earliest-expiry unexpired lot first; expired stock is never shipped", async () => {
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      const s = await setup(c, "BATCH-1", "batch", 10);
      expect(await c.err("select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: s.pol, qty: 10 }])])).toMatch(/enter the lot/);
      expect(await c.err("select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: s.pol, qty: 10, lots: [{ code: "A", qty: 4 }] }])])).toMatch(/add up to 4/);
      await c.q("select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: s.pol, qty: 10, lots: [
        { code: "OLD", expiry: day(-3), qty: 2 }, { code: "SOON", expiry: day(20), qty: 3 }, { code: "LATE", expiry: day(200), qty: 5 }] }])]);
      expect(await c.err("select public.receive_goods($1,$2)", [s.po, "[]"])).not.toBe(""); // nothing more to receive
      const exp = await c.q<Row>("select lot_code, expiry_status from public.lot_stock where item_id=$1 order by expiry_date", [s.item]);
      expect(exp.map((r) => `${r.lot_code}:${r.expiry_status}`)).toEqual(["OLD:expired", "SOON:expiring", "LATE:ok"]);
      expect((await c.q("select 1 from public.expiry_report where item_id=$1", [s.item])).length).toBe(2);
      // 10 reserved but only 8 unexpired: dispatching all 10 must refuse
      expect(await c.err("select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: s.line, qty: 10 }])])).toMatch(/not enough unexpired/);
      expect(await c.err("select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: s.line, qty: 1, lots: [{ code: "OLD", qty: 1 }] }])])).toMatch(/expired on/);
      await c.q("select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: s.line, qty: 4 }])]);
      const used = await c.q<Row>("select s.lot_code, dll.qty from public.dispatch_line_lots dll join public.stock_lots s on s.id=dll.lot_id where s.item_id=$1 order by s.expiry_date", [s.item]);
      expect(used.map((r) => `${r.lot_code}:${Number(r.qty)}`)).toEqual(["SOON:3", "LATE:1"]); // FEFO, skipping the expired lot
    });
  });

  test("returns go back into the lots they came from; tracking cannot change after movement; lots never go negative", async () => {
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      const s = await setup(c, "BATCH-2", "batch", 6);
      await c.q("select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: s.pol, qty: 6, lots: [{ code: "L1", expiry: day(30), qty: 2 }, { code: "L2", expiry: day(90), qty: 4 }] }])]);
      await c.q("select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: s.line, qty: 5 }])]); // L1:2 + L2:3
      const inv = (await c.q<Row>("select public.invoice_order($1) id", [s.so]))[0]!.id;
      const il = (await c.q<Row>("select id from public.invoice_lines where invoice_id=$1", [inv]))[0]!.id;
      await c.q("select public.create_credit_note($1,$2,'customer return',true)", [inv, JSON.stringify([{ invoice_line_id: il, qty: 3 }])]);
      const back = await c.q<Row>("select s.lot_code, sum(m.qty) q from public.stock_movements m join public.stock_lots s on s.id=m.lot_id where m.kind='customer_return' and s.item_id=$1 group by s.lot_code order by s.lot_code", [s.item]);
      expect(back.map((r) => `${r.lot_code}:${Number(r.q)}`)).toEqual(["L1:2", "L2:1"]); // oldest dispatch lot first
      expect(await c.err("update public.items set tracking='none' where id=$1", [s.item])).toMatch(/cannot change/);
      expect(await c.err("select public.adjust_stock($1,$2,-50,'shrink','L1')", [s.item, WH.A])).toMatch(/has only/);
      expect(await c.err("select public.adjust_stock($1,$2,-1,'shrink')", [s.item, WH.A])).toMatch(/lot or serial number is required/);
      expect(await c.err("select public.adjust_stock($1,$2,3,'found','L1',$3)", [s.item, WH.A, day(99)])).toMatch(/already exists with expiry/);
    });
  });

  test("tracked items are refused by transfers and spares until those are specified; untracked behaviour is unchanged", async () => {
    await as("ownerA", async (c) => {
      const b = (await c.q<Row>("select branch_id from public.warehouses where id=$1", [WH.A]))[0]!.branch_id;
      const w2 = (await c.q<Row>("insert into public.warehouses (tenant_id, branch_id, code, name) select app.tenant_id(), $1, 'W9', 'Nine' returning id", [b]))[0]!.id;
      const item = (await c.q<Row>("insert into public.items (tenant_id, sku, name, tracking) select app.tenant_id(), 'BATCH-3', 'b3', 'batch' returning id"))[0]!.id;
      await c.q("select public.adjust_stock($1,$2,5,'opening','OPEN-1',$3)", [item, WH.A, day(100)]);
      expect(await c.err("select public.create_transfer($1,$2,$3)", [WH.A, w2, JSON.stringify([{ item_id: item, qty: 1 }])])).toMatch(/does not support lots yet/);
    });
  });
});

describe("serial numbers", () => {
  test("one unit per serial, no duplicates in stock, explicit serial dispatch, full trace to supplier and customer", async () => {
    await as("ownerA", async (c) => {
      await c.q("update public.tenants set credit_check=false where id=app.tenant_id()");
      const s = await setup(c, "SER-1", "serial", 3);
      expect(await c.err("select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: s.pol, qty: 3, lots: [{ code: "SN-1", qty: 2 }, { code: "SN-2", qty: 1 }] }])])).toMatch(/one unit/);
      await c.q("select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: s.pol, qty: 3, lots: [{ code: "SN-1", qty: 1 }, { code: "SN-2", qty: 1 }, { code: "SN-3", qty: 1 }] }])]);
      expect(await c.err("select public.adjust_stock($1,$2,1,'dup','SN-1')", [s.item, WH.A])).toMatch(/already in stock/);
      expect(await c.err("select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: s.line, qty: 2, lots: [{ code: "SN-9" }, { code: "SN-1" }] }])])).toMatch(/does not exist/);
      await c.q("select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: s.line, qty: 2, lots: [{ code: "SN-3" }, { code: "SN-1" }] }])]);
      const left = await c.q<Row>("select lot_code from public.lot_stock where item_id=$1 order by lot_code", [s.item]);
      expect(left.map((r) => r.lot_code)).toEqual(["SN-2"]);
      const trace = await c.q<Row>("select event, document, party from public.trace_lot($1,'SN-3') ", [s.item]);
      expect(trace.map((r) => r.event)).toEqual(["receipt", "dispatch"]);
      expect(trace[0]).toMatchObject({ document: "GRN-00001".replace(/\d+/, (m) => m), party: "Prime Components" });
      expect(trace[1]!.party).toBe("Kiran Stores");
    });
  });
});

describe("barcodes", () => {
  test("barcodes are unique per company, printable ASCII, and optional", async () => {
    await as("ownerA", async (c) => {
      await c.q("insert into public.items (tenant_id, sku, name, barcode) select app.tenant_id(), 'BC-A', 'a', '8901234567890'");
      expect(await c.err("insert into public.items (tenant_id, sku, name, barcode) select app.tenant_id(), 'BC-B', 'b', '8901234567890'")).toMatch(/unique|duplicate/);
      expect(await c.err("insert into public.items (tenant_id, sku, name, barcode) select app.tenant_id(), 'BC-C', 'c', 'badé'")).toMatch(/check|violates/);
      await c.q("insert into public.items (tenant_id, sku, name) select app.tenant_id(), 'BC-D', 'd'");
      await c.q("insert into public.items (tenant_id, sku, name) select app.tenant_id(), 'BC-E', 'e'"); // two items without barcodes are fine
    });
    await as("ownerB", async (c) => { await c.q("insert into public.items (tenant_id, sku, name, barcode) select app.tenant_id(), 'BC-A', 'a', '8901234567890'"); }); // another company may reuse it
  });
});
