import { beforeAll, describe, expect, test } from "vitest";
import { as, fails, ITEM, CUST, SUP, seed, WH, TENANT, admin } from "./helpers";

const base: Record<string, number> = {};
beforeAll(async () => {
  await seed();
  for (const k of ["ar", "bank", "inventory", "cogs", "grni"]) base[k] = await bal(k);
});

type Row = Record<string, any>;
async function bal(key: string) { return (await as("acctA", (c) => c.q<Row>("select balance_paise b from public.trial_balance tb join public.accounts a on a.id=tb.account_id where a.system_key=$1", [key])))[0]!.b as number; }
const stock = async (sku: string) =>
  (await as("whA", (c) => c.q<Row>("select on_hand, reserved from public.stock_levels where item_id=$1 and warehouse_id=$2", [ITEM[sku], WH.A])))[0]!;

describe("approved sale → reservation → shortage → purchase → partial receipt → dispatch → invoice → partial collection", () => {
  const s: Record<string, string> = {};

  test("order is created, confirmed and reports a shortage when there is no stock", async () => {
    s.so = (await as("salesA", (c) => c.q<Row>("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A,
      JSON.stringify([{ item_id: ITEM["WID-1"], qty: 10 }])]), true))[0]!.id;
    const short = await as("salesA", (c) => c.q<Row>("select * from public.confirm_sales_order($1)", [s.so]), true);
    expect(short).toHaveLength(1);
    expect(short[0]!.shortage).toBe(10);
    const st = await stock("WID-1");
    expect(st.reserved).toBe(0);
  });

  test("shortage becomes one purchase request, idempotently", async () => {
    expect((await as("salesA", (c) => c.q<Row>("select public.request_shortage_purchases($1) n", [s.so]), true))[0]!.n).toBe(1);
    expect((await as("salesA", (c) => c.q<Row>("select public.request_shortage_purchases($1) n", [s.so]), true))[0]!.n).toBe(0);
    s.pr = (await as("purchA", (c) => c.q<Row>("select id from public.purchase_requests where status='pending'")))[0]!.id;
  });

  test("a warehouse user cannot approve purchases; a purchaser can", async () => {
    expect(await fails("whA", "select public.approve_purchase_request($1,$2,60000)", [s.pr, SUP["Prime Components"]])).toMatch(/role not permitted/);
    s.po = (await as("purchA", (c) => c.q<Row>("select public.approve_purchase_request($1,$2,60000) id", [s.pr, SUP["Prime Components"]]), true))[0]!.id;
  });

  test("partial receipt reserves stock for the waiting order, and retry is safe", async () => {
    const line = (await as("whA", (c) => c.q<Row>("select id from public.purchase_order_lines where po_id=$1", [s.po])))[0]!.id;
    s.pol = line;
    const g1 = (await as("whA", (c) => c.q<Row>("select public.receive_goods($1,$2,'k1') id", [s.po, JSON.stringify([{ po_line_id: line, qty: 6 }])]), true))[0]!.id;
    const g2 = (await as("whA", (c) => c.q<Row>("select public.receive_goods($1,$2,'k1') id", [s.po, JSON.stringify([{ po_line_id: line, qty: 6 }])]), true))[0]!.id;
    expect(g2).toBe(g1);
    const st = await stock("WID-1");
    expect(st.on_hand).toBe(6);
    expect(st.reserved).toBe(6);
    expect(await fails("whA", "select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: line, qty: 5 }])])).toMatch(/over-receipt/);
  });

  test("only reserved quantity can be dispatched; dispatch posts cost of goods", async () => {
    const sol = (await as("whA", (c) => c.q<Row>("select id from public.sales_order_lines where order_id=$1", [s.so])))[0]!.id;
    s.sol = sol;
    expect(await fails("whA", "select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: sol, qty: 7 }])])).toMatch(/only 6/);
    await as("whA", (c) => c.q("select public.dispatch_order($1,$2,'AWB1')", [s.so, JSON.stringify([{ so_line_id: sol, qty: 6 }])]), true);
    const st = await stock("WID-1");
    expect(st.on_hand).toBe(0);
    expect(st.reserved).toBe(0);
    expect((await bal("cogs")) - base.cogs).toBe(360000);
    expect((await as("salesA", (c) => c.q<Row>("select status from public.sales_orders where id=$1", [s.so])))[0]!.status).toBe("partially_dispatched");
  });

  test("invoice covers what shipped, with GST, and posts to receivables", async () => {
    s.inv = (await as("acctA", (c) => c.q<Row>("select public.invoice_order($1) id", [s.so]), true))[0]!.id;
    const inv = (await as("acctA", (c) => c.q<Row>("select subtotal_paise s, tax_paise t, total_paise tot from public.invoices where id=$1", [s.inv])))[0]!;
    expect([inv.s, inv.t, inv.tot]).toEqual([600000, 108000, 708000]);
    expect((await bal("ar")) - base.ar).toBe(708000);
    expect(await fails("acctA", "select public.invoice_order($1)", [s.so])).toMatch(/nothing dispatched/);
  });

  test("partial collection updates the invoice and cannot over-allocate", async () => {
    await as("acctA", (c) => c.q("select public.record_payment($1,'bank',$2,'UTR1')", [CUST["Kiran Stores"], JSON.stringify([{ invoice_id: s.inv, amount_paise: 300000 }])]), true);
    const inv = (await as("acctA", (c) => c.q<Row>("select status, paid_paise p from public.invoices where id=$1", [s.inv])))[0]!;
    expect([inv.status, inv.p]).toEqual(["partially_paid", 300000]);
    expect((await bal("ar")) - base.ar).toBe(408000);
    expect((await bal("bank")) - base.bank).toBe(300000);
    expect(await fails("acctA", "select public.record_payment($1,'bank',$2)", [CUST["Kiran Stores"], JSON.stringify([{ invoice_id: s.inv, amount_paise: 408001 }])])).toMatch(/exceeds/);
  });

  test("remaining receipt, dispatch and invoice close the order; stock and finance reconcile", async () => {
    await as("whA", (c) => c.q("select public.receive_goods($1,$2)", [s.po, JSON.stringify([{ po_line_id: s.pol, qty: 4 }])]), true);
    await as("whA", (c) => c.q("select public.dispatch_order($1,$2)", [s.so, JSON.stringify([{ so_line_id: s.sol, qty: 4 }])]), true);
    await as("acctA", (c) => c.q("select public.invoice_order($1)", [s.so]), true);
    expect((await as("salesA", (c) => c.q<Row>("select status from public.sales_orders where id=$1", [s.so])))[0]!.status).toBe("invoiced");
    expect((await bal("inventory")) - base.inventory).toBe(0);
    expect((await bal("cogs")) - base.cogs).toBe(600000);
    expect((await bal("grni")) - base.grni).toBe(-600000);
  });

  test("a supplier bill within tolerance clears GRNI; outside needs a reason and a manager", async () => {
    expect(await fails("purchA", "select public.post_supplier_bill($1,'S-1',700000)", [s.po])).toMatch(/exception reason is required/);
    expect(await fails("purchA", "select public.post_supplier_bill($1,'S-1',700000,'supplier price rise agreed')", [s.po])).toMatch(/only a manager/);
    await as("purchA", (c) => c.q("select public.post_supplier_bill($1,'S-2',605000)", [s.po]), true); // +0.83%, within 2%
    expect((await bal("grni")) - base.grni).toBe(0);
    expect((await bal("inventory")) - base.inventory).toBe(5000);
    expect(await fails("purchA", "select public.post_supplier_bill($1,'S-2',605000)", [s.po])).toMatch(/duplicate|unique/);
  });

  test("every posted journal balances and the trial balance nets to zero", async () => {
    const r = (await as("acctA", (c) => c.q<Row>("select sum(debit_paise) d, sum(credit_paise) c from public.trial_balance")))[0]!;
    expect(r.d).toBe(r.c);
    const unbalanced = await admin("select entry_id from public.journal_lines group by entry_id having sum(debit_paise) <> sum(credit_paise)");
    expect(unbalanced).toHaveLength(0);
  });
});
