import { requireCompany } from "@/lib/server/auth";
import { rd, PER, pg, opts, itemOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Filters, Pager, A, Badge, Field, Grid, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createWoAction } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Work orders" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("prod.read"); const sp = await searchParams; const page = pg(sp);
  const d = await rd(a, async (c) => { const w = [sp.q ? "(w.number ilike $1 or i.code ilike $1)" : "true", ["planned", "released", "in_progress", "completed", "cancelled"].includes(sp.status ?? "") ? `w.status='${sp.status}'` : "true"].join(" and "); const p = sp.q ? [`%${sp.q}%`] : [];
    return { rows: (await c.query(`select w.*, i.code, pl.code plant from work_orders w join items i on i.id=w.item_id join plants pl on pl.id=w.plant_id where ${w} order by w.due_date, w.number limit ${PER} offset ${(page - 1) * PER}`, p)).rows, total: Number((await c.query(`select count(*) n from work_orders w join items i on i.id=w.item_id where ${w}`, p)).rows[0].n), items: await itemOpts(c, "active and kind <> 'buy'"), plants: opts((await c.query("select id, code, name from plants where active")).rows) }; });
  return <Page title="Work orders" sub="Released jobs carry a frozen BOM and routing snapshot.">
    <Filters action="/app/production" q={sp.q}><div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={sp.status ?? ""} className="input w-40"><option value="">All</option>{["planned", "released", "in_progress", "completed", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></div></Filters>
    <DataTable rows={d.rows} empty="No work orders. Release an MRP suggestion or create one below." cols={[{ h: "Job", r: (r: any) => <A href={`/app/production/${r.id}`}>{r.number}</A> }, { h: "Item", r: (r: any) => r.code }, { h: "Plant", r: (r: any) => r.plant, hideSm: true }, { h: "Qty", r: (r: any) => `${fmt(r.completed_qty)} / ${fmt(r.qty)}`, num: true }, { h: "Due", r: (r: any) => date(r.due_date) }, { h: "Status", r: (r: any) => <><Badge s={r.status} />{r.is_rework && <span className="ml-1 text-xs text-warn">rework</span>}</> }]} />
    <Pager page={page} total={d.total} per={PER} base={`/app/production?q=${sp.q ?? ""}&status=${sp.status ?? ""}`} />
    {can(a.membership.role, "prod.write") && <Card title="Create work order" className="mt-5"><ActionForm action={createWoAction} submit="Create job"><Grid cols={4}><Field label="Item" name="item" required options={d.items} /><Field label="Quantity" name="qty" type="number" step="any" required /><Field label="Due date" name="due" type="date" required /><Field label="Plant" name="plant" required options={d.plants} /></Grid></ActionForm></Card>}</Page>;
}
