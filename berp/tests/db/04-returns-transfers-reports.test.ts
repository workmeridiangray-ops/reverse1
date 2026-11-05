import { beforeAll, describe, expect, test } from "vitest";
import { as, CUST, ITEM, seed, WH } from "./helpers";

beforeAll(seed);
type Row = Record<string, any>;

/** Builds confirmed → dispatched → invoiced order for qty units of GAD-1 (price 25,050, cost 15,000, GST 18%). */
async function sold(c: any, qty: number, restockQty = 10) {
  await c.q("select public.adjust_stock($1,$2,$3,'test stock')", [ITEM["GAD-1"], WH.A, restockQty]);
  const so = (await c.q("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["GAD-1"], qty }])]))[0].id;
  await c.q("select * from public.confirm_sales_order($1)", [so]);
  const line = (await c.q("select id from public.sales_order_lines where order_id=$1", [so]))[0].id;
  await c.q("select public.dispatch_order($1,$2)", [so, JSON.stringify([{ so_line_id: line, qty }])]);
  const inv = (await c.q("select public.invoice_order($1) id", [so]))[0].id;
  const il = (await c.q("select id, cogs_paise from public.invoice_lines where invoice_id=$1", [inv]))[0];
  return { so, inv, il };
}
const bal = async (c: any, key: string) => Number((await c.q("select balance_paise b from public.trial_balance tb join public.accounts a on a.id=tb.account_id where a.system_key=$1", [key]))[0].b);
const onHand = async (c: any) => Number((await c.q("select on_hand from public.stock_levels where item_id=$1 and warehouse_id=$2", [ITEM["GAD-1"], WH.A]))[0].on_hand);

describe("credit notes and returns", () => {
  test("a restocked return reverses revenue, tax, receivable and cost exactly once", async () => {
    await as("ownerA", async (c) => {
      const { inv, il } = await sold(c, 4);
      expect(Number(il!.cogs_paise)).toBe(60000); // 4 × 15,000 captured at dispatch
      const before = { ar: await bal(c, "ar"), stock: await onHand(c), inv: await bal(c, "inventory"), cogs: await bal(c, "cogs") };
      const cn = (await c.q("select public.create_credit_note($1,$2,'damaged on arrival',true) id", [inv, JSON.stringify([{ invoice_line_id: il.id, qty: 1 }])]))[0]!.id;
      const n = (await c.q<Row>("select subtotal_paise s, tax_paise t, total_paise tot from public.credit_notes where id=$1", [cn]))[0]!;
      expect([n.s, n.t, n.tot]).toEqual([25050, 4509, 29559]);
      expect(before.ar - (await bal(c, "ar"))).toBe(29559);
      expect((await onHand(c)) - before.stock).toBe(1);
      expect((await bal(c, "inventory")) - before.inv).toBe(15000);
      expect(before.cogs - (await bal(c, "cogs"))).toBe(15000);
      const i = (await c.q<Row>("select credited_paise cr, status from public.invoices where id=$1", [inv]))[0]!;
      expect(i.cr).toBe(29559);
      expect(i.status).toBe("partially_paid");
      expect(await c.err("select public.create_credit_note($1,$2,'again',true)", [inv, JSON.stringify([{ invoice_line_id: il.id, qty: 4 }])])).toMatch(/cannot credit/);
      expect(await c.err("select public.create_credit_note($1,$2,'',true)", [inv, JSON.stringify([{ invoice_line_id: il.id, qty: 1 }])])).toMatch(/reason is required/);
    });
  });
  test("a non-restocked credit leaves stock alone; full credit settles the invoice; sales role cannot issue one", async () => {
    await as("ownerA", async (c) => {
      const { inv, il } = await sold(c, 2);
      const stock = await onHand(c);
      await c.q("select public.create_credit_note($1,$2,'price dispute',false)", [inv, JSON.stringify([{ invoice_line_id: il.id, qty: 2 }])]);
      expect(await onHand(c)).toBe(stock);
      expect((await c.q<Row>("select status from public.invoices where id=$1", [inv]))[0]!.status).toBe("paid");
    });
    await as("ownerA", async (c) => {
      const { inv, il } = await sold(c, 1);
      await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "00000000-0000-4000-8000-000000000003" })]);
      expect(await c.err("select public.create_credit_note($1,$2,'x y z',true)", [inv, JSON.stringify([{ invoice_line_id: il.id, qty: 1 }])])).toMatch(/role not permitted/);
    });
  });
  test("a credit cannot exceed what is still owed once receipts are applied", async () => {
    await as("ownerA", async (c) => {
      const { inv, il } = await sold(c, 2);
      await c.q("select public.record_payment($1,'bank',$2)", [CUST["Kiran Stores"], JSON.stringify([{ invoice_id: inv, amount_paise: 50000 }])]);
      expect(await c.err("select public.create_credit_note($1,$2,'too much',false)", [inv, JSON.stringify([{ invoice_line_id: il.id, qty: 2 }])])).toMatch(/exceeds the unpaid balance/);
    });
  });
  test("margin report uses cost at dispatch; ageing nets credits", async () => {
    await as("ownerA", async (c) => {
      const { inv, il } = await sold(c, 3);
      await c.q("select public.create_credit_note($1,$2,'one back',true)", [inv, JSON.stringify([{ invoice_line_id: il.id, qty: 1 }])]);
      const m = (await c.q<Row>("select net_paise n, cogs_paise g, margin_paise m from public.sales_margin where invoice_id=$1", [inv]))[0]!;
      expect([m.n, m.g, m.m]).toEqual([75150, 45000, 30150]);
      const a = (await c.q<Row>("select balance_paise b, bucket from public.receivables_ageing where invoice_id=$1", [inv]))[0]!;
      expect(a.b).toBe(88677 - 29559);
      expect(a.bucket).toBe("current");
    });
  });
});

describe("warehouse transfers", () => {
  test("transfer moves available stock, shows in transit, and cannot move reserved units", async () => {
    await as("ownerA", async (c) => {
      const b = (await c.q<Row>("select branch_id from public.warehouses where id=$1", [WH.A]))[0]!.branch_id;
      const w2 = (await c.q<Row>("insert into public.warehouses (tenant_id, branch_id, code, name) select app.tenant_id(), $1, 'W2', 'Second' returning id", [b]))[0]!.id;
      await c.q("select public.adjust_stock($1,$2,6,'for transfer')", [ITEM["WID-1"], WH.A]);
      const start = Number((await c.q("select on_hand from public.stock_levels where item_id=$1 and warehouse_id=$2", [ITEM["WID-1"], WH.A]))[0]!.on_hand);
      // reserve some via an order
      const so = (await c.q<Row>("select public.create_sales_order($1,$2,$3) id", [CUST["Kiran Stores"], WH.A, JSON.stringify([{ item_id: ITEM["WID-1"], qty: 2 }])]))[0]!.id;
      await c.q("select * from public.confirm_sales_order($1)", [so]);
      expect(await c.err("select public.create_transfer($1,$2,$3)", [WH.A, w2, JSON.stringify([{ item_id: ITEM["WID-1"], qty: start }])])).toMatch(/only .* available/);
      const tr = (await c.q<Row>("select public.create_transfer($1,$2,$3) id", [WH.A, w2, JSON.stringify([{ item_id: ITEM["WID-1"], qty: 3 }])]))[0]!.id;
      expect(Number((await c.q<Row>("select qty from public.in_transit_stock where transfer_id=$1", [tr]))[0]!.qty)).toBe(3);
      expect((await c.q("select 1 from public.stock_levels where item_id=$1 and warehouse_id=$2 and on_hand=0", [ITEM["WID-1"], w2])).length).toBe(1);
      await c.q("select public.receive_transfer($1)", [tr]);
      expect(Number((await c.q<Row>("select on_hand from public.stock_levels where item_id=$1 and warehouse_id=$2", [ITEM["WID-1"], w2]))[0]!.on_hand)).toBe(3);
      expect(await c.err("select public.receive_transfer($1)", [tr])).toMatch(/already received/);
      expect((await c.q("select 1 from public.in_transit_stock where transfer_id=$1", [tr])).length).toBe(0);
    });
  });
});
