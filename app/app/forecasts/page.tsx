import { requireCompany } from "@/lib/server/auth";
import { rd, itemOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Field, Grid, Note, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { saveForecast } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Forecasts" };
export default async function P() {
  const a = await requireCompany("sales.read");
  const d = await rd(a, async (c) => ({ rows: (await c.query("select f.*, i.code, coalesce((select sum(l.qty) from sales_order_lines l join sales_orders o on o.id=l.order_id where o.status='confirmed' and l.item_id=f.item_id and l.due_date >= f.period_start and l.due_date < f.period_start + interval '1 month'),0) confirmed from forecasts f join items i on i.id=f.item_id order by f.period_start, i.code")).rows, items: await itemOpts(c, "active and kind <> 'buy'") }));
  return <Page title="Forecasts" sub="Forecast is not an order. MRP only plans the part of a month’s forecast that confirmed orders do not already cover.">
    <Note>Net forecast = max(forecast − confirmed orders due in the same month, 0). It is never added on top of orders.</Note>
    <DataTable rows={d.rows} empty="No forecasts." cols={[{ h: "Month", r: (r: any) => String(r.period_start).slice(0, 7) }, { h: "Item", r: (r: any) => r.code }, { h: "Forecast", r: (r: any) => fmt(r.qty), num: true }, { h: "Confirmed orders", r: (r: any) => fmt(r.confirmed), num: true }, { h: "Net planned", r: (r: any) => fmt(Math.max(0, Number(r.qty) - Number(r.confirmed))), num: true }]} />
    {can(a.membership.role, "sales.write") && <Card title="Add or update forecast" className="mt-4"><ActionForm action={saveForecast} submit="Save forecast" resetOnOk><Grid cols={3}><Field label="Item" name="item" required options={d.items} /><Field label="Month" name="month" type="month" required /><Field label="Quantity" name="qty" type="number" required /></Grid></ActionForm></Card>}</Page>;
}
