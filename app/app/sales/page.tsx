import { requireCompany } from "@/lib/server/auth";
import { rd, PER, pg, opts, itemOpts } from "@/lib/server/read";
import { Page, DataTable, Filters, Pager, A, Badge, Card, Field, Grid, LinkBtn, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createQuote } from "../actions";
import { can } from "@/lib/server/perms";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Sales orders" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("sales.read"); const sp = await searchParams; const page = pg(sp);
  const d = await rd(a, async (c) => { const w = [sp.q ? "(o.number ilike $1 or cu.name ilike $1)" : "true", ["draft", "confirmed", "closed", "cancelled"].includes(sp.status ?? "") ? `o.status='${sp.status}'` : "true"].join(" and "); const p = sp.q ? [`%${sp.q}%`] : [];
    return { rows: (await c.query(`select o.*, cu.name customer, (select count(*) from sales_order_lines l where l.order_id=o.id) lines, (select min(due_date) from sales_order_lines l where l.order_id=o.id) due from sales_orders o join customers cu on cu.id=o.customer_id where ${w} order by o.created_at desc limit ${PER} offset ${(page - 1) * PER}`, p)).rows, total: Number((await c.query(`select count(*) n from sales_orders o join customers cu on cu.id=o.customer_id where ${w}`, p)).rows[0].n),
      quotes: (await c.query("select q.*, cu.name customer, i.code from quotations q join customers cu on cu.id=q.customer_id join items i on i.id=q.item_id order by q.created_at desc limit 10")).rows, cust: opts((await c.query("select id, code, name from customers order by code")).rows), items: await itemOpts(c, "active and kind <> 'buy'") }; });
  const w = can(a.membership.role, "sales.write");
  return <Page title="Customer orders & quotations" actions={w ? <LinkBtn primary href="/app/sales/new">New order</LinkBtn> : undefined}>
    <Filters action="/app/sales" q={sp.q}><div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={sp.status ?? ""} className="input w-40"><option value="">All</option>{["draft", "confirmed", "closed", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></div></Filters>
    <DataTable caption="Sales orders" rows={d.rows} empty="No orders yet." cols={[{ h: "Order", r: (r: any) => <A href={`/app/sales/${r.id}`}>{r.number}</A> }, { h: "Customer", r: (r: any) => r.customer }, { h: "Lines", r: (r: any) => r.lines, num: true, hideSm: true }, { h: "First due", r: (r: any) => date(r.due), hideSm: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} />
    <Pager page={page} total={d.total} per={PER} base={`/app/sales?q=${sp.q ?? ""}&status=${sp.status ?? ""}`} />
    <div className="mt-6 grid gap-4 lg:grid-cols-2"><Card title="Recent quotations"><DataTable rows={d.quotes} empty="No quotations." cols={[{ h: "No.", r: (r: any) => r.number }, { h: "Customer", r: (r: any) => r.customer, hideSm: true }, { h: "Item", r: (r: any) => `${r.code} × ${fmt(r.qty)}` }, { h: "Est. cost", r: (r: any) => formatINR(r.est_cost_paise), num: true }, { h: "Quote", r: (r: any) => formatINR(r.quoted_price_paise), num: true }]} /></Card>
      {w && <Card title="New quotation (from standard-cost estimate)"><ActionForm action={createQuote} submit="Create quotation" resetOnOk><Grid><Field label="Customer" name="customer" required options={d.cust} /><Field label="Item" name="item" required options={d.items} /><Field label="Quantity" name="qty" type="number" required /><Field label="Margin %" name="margin" type="number" defaultValue="20" /></Grid></ActionForm></Card>}</div></Page>;
}
