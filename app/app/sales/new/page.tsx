import { requireCompany } from "@/lib/server/auth";
import { rd, opts, itemOpts } from "@/lib/server/read";
import { Page, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createOrder } from "../../actions";
export const metadata = { title: "New order" };
export default async function P() {
  const a = await requireCompany("sales.write");
  const d = await rd(a, async (c) => ({ cust: opts((await c.query("select id, code, name from customers where active order by code")).rows), items: await itemOpts(c, "active and kind <> 'buy'") }));
  return <Page title="New customer order" crumbs={[["Orders", "/app/sales"], ["New"]]} sub="Saved as a draft. Confirm it to make it count as demand for planning.">
    <ActionForm action={createOrder} submit="Save draft order"><Card><Field label="Customer" name="customer" required options={d.cust} className="max-w-md" />
      <div className="mt-4 space-y-3">{[1, 2, 3, 4, 5].map((n) => <div key={n} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]"><Field label={`Line ${n} item`} name={`item${n}`} options={d.items} /><Field label="Quantity" name={`qty${n}`} type="number" /><Field label="Due date" name={`due${n}`} type="date" /><Field label="Supply" name={`supply${n}`} options={[{ value: "mto", label: "Make to order" }, { value: "mts", label: "From stock (MTS)" }]} defaultValue="mto" /></div>)}</div>
      <p className="mt-3 text-xs text-muted">Leave unused lines blank. Lines with an item need a quantity and due date.</p></Card></ActionForm></Page>;
}
