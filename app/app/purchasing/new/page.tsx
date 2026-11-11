import { requireCompany } from "@/lib/server/auth";
import { rd, opts, itemOpts } from "@/lib/server/read";
import { Page, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createPoAction } from "../../actions";
export const metadata = { title: "New purchase order" };
export default async function P() {
  const a = await requireCompany("proc.write");
  const d = await rd(a, async (c) => ({ sup: opts((await c.query("select id, code, name from suppliers where active order by code")).rows), items: await itemOpts(c, "active and kind <> 'make'") }));
  return <Page title="New purchase order" crumbs={[["Purchase orders", "/app/purchasing"], ["New"]]} sub="Created as a draft. A different person with approval authority must approve it.">
    <ActionForm action={createPoAction} submit="Save draft"><Card><Field label="Supplier" name="supplier" required options={d.sup} className="max-w-md" />
      <div className="mt-4 space-y-3">{[1, 2, 3, 4, 5].map((n) => <div key={n} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]"><Field label={`Line ${n} item`} name={`item${n}`} options={d.items} /><Field label="Quantity" name={`qty${n}`} type="number" /><Field label="Unit price (₹)" name={`price${n}`} placeholder="0.00" /><Field label="Due date" name={`due${n}`} type="date" /></div>)}</div></Card></ActionForm></Page>;
}
