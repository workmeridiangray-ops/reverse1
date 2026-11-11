import { requireCompany } from "@/lib/server/auth";
import { rd, PER, pg } from "@/lib/server/read";
import { Page, DataTable, Filters, Pager, A, Badge, Card, Field, Grid, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { saveItem, saveUom } from "../actions";
import { can } from "@/lib/server/perms";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Items" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("master.read"); const sp = await searchParams; const page = pg(sp);
  const { rows, total, uoms } = await rd(a, async (c) => {
    const w = [sp.q ? "(code ilike $1 or name ilike $1)" : "true", sp.kind ? `kind='${sp.kind === "make" || sp.kind === "buy" || sp.kind === "subcontract" ? sp.kind : "make"}'` : "true"].join(" and "); const p = sp.q ? [`%${sp.q}%`] : [];
    return { rows: (await c.query(`select i.*, coalesce((select sum(qty) from stock_balances b where b.item_id=i.id),0) onhand from items i where ${w} order by code limit ${PER} offset ${(page - 1) * PER}`, p)).rows, total: Number((await c.query(`select count(*) n from items where ${w}`, p)).rows[0].n), uoms: (await c.query("select code from uoms order by code")).rows };
  });
  const canW = can(a.membership.role, "master.write");
  return <Page title="Items" sub="Manufactured, purchased and subcontracted items. Changing a master never alters released jobs.">
    <Filters action="/app/items" q={sp.q}><div><label className="label" htmlFor="kind">Type</label><select id="kind" name="kind" defaultValue={sp.kind ?? ""} className="input w-40"><option value="">All</option><option value="make">Make</option><option value="buy">Buy</option><option value="subcontract">Subcontract</option></select></div></Filters>
    <DataTable caption="Items" rows={rows} empty="No items yet. Add one below or import a CSV in Settings → Import." cols={[
      { h: "Code", r: (r: any) => <A href={`/app/items/${r.id}`}>{r.code}</A> }, { h: "Name", r: (r: any) => r.name }, { h: "Type", r: (r: any) => <Badge s={r.kind === "make" ? "released" : "neutral"} label={r.kind} /> },
      { h: "Rev", r: (r: any) => r.revision, hideSm: true }, { h: "Tracking", r: (r: any) => r.tracking, hideSm: true }, { h: "Lead (d)", r: (r: any) => r.lead_time_days, num: true, hideSm: true },
      { h: "Std cost", r: (r: any) => formatINR(r.std_cost_paise), num: true, hideSm: true }, { h: "On hand", r: (r: any) => `${fmt(r.onhand, 3)} ${r.uom}`, num: true }]} />
    <Pager page={page} total={total} per={PER} base={`/app/items?q=${sp.q ?? ""}&kind=${sp.kind ?? ""}`} />
    {canW && <div className="mt-6 grid gap-4 lg:grid-cols-3"><Card title="Add item" className="lg:col-span-2"><ActionForm action={saveItem} submit="Create item" resetOnOk><Grid cols={3}>
      <Field label="Item code" name="code" required placeholder="PUMP-100" /><Field label="Name" name="name" required className="sm:col-span-2" />
      <Field label="Type" name="kind" required options={[{ value: "make", label: "Manufactured" }, { value: "buy", label: "Purchased" }, { value: "subcontract", label: "Subcontracted" }]} />
      <Field label="Unit" name="uom" required options={uoms.map((u: any) => ({ value: u.code, label: u.code }))} hint={uoms.length ? undefined : "Add a unit first →"} />
      <Field label="Tracking" name="tracking" options={[{ value: "none", label: "None" }, { value: "batch", label: "Batch" }, { value: "serial", label: "Serial" }]} />
      <Field label="Lot size" name="lot" type="number" defaultValue="1" /><Field label="Lead time (working days)" name="lt" type="number" defaultValue="0" /><Field label="Safety stock" name="ss" type="number" defaultValue="0" />
      <Field label="Standard cost (₹)" name="std" placeholder="1250.00" hint="Per unit. Up to 2 decimals." /></Grid></ActionForm></Card>
      <Card title="Add unit of measure"><ActionForm action={saveUom} submit="Add unit" resetOnOk><Field label="Code" name="code" required placeholder="KG" /><Field label="Name" name="name" required placeholder="Kilogram" className="mt-2" /></ActionForm></Card></div>}
  </Page>;
}
