import { requireCompany } from "@/lib/server/auth";
import { rd, PER, pg } from "@/lib/server/read";
import { Page, DataTable, Filters, Pager, A, Badge, LinkBtn, date } from "@/components/ui";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Purchase orders" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("proc.read"); const sp = await searchParams; const page = pg(sp);
  const d = await rd(a, async (c) => { const w = [sp.q ? "(p.number ilike $1 or s.name ilike $1)" : "true", ["draft", "pending_approval", "approved", "partial", "received", "cancelled"].includes(sp.status ?? "") ? `p.status='${sp.status}'` : "true"].join(" and "); const p = sp.q ? [`%${sp.q}%`] : [];
    return { rows: (await c.query(`select p.*, s.name supplier, (select min(due_date) from purchase_order_lines l where l.po_id=p.id) due from purchase_orders p join suppliers s on s.id=p.supplier_id where ${w} order by p.created_at desc limit ${PER} offset ${(page - 1) * PER}`, p)).rows, total: Number((await c.query(`select count(*) n from purchase_orders p join suppliers s on s.id=p.supplier_id where ${w}`, p)).rows[0].n) }; });
  return <Page title="Purchase orders" actions={can(a.membership.role, "proc.write") ? <LinkBtn primary href="/app/purchasing/new">New purchase order</LinkBtn> : undefined}>
    <Filters action="/app/purchasing" q={sp.q}><div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={sp.status ?? ""} className="input w-44"><option value="">All</option>{["draft", "pending_approval", "approved", "partial", "received", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></div></Filters>
    <DataTable rows={d.rows} empty="No purchase orders yet." cols={[{ h: "PO", r: (r: any) => <A href={`/app/purchasing/${r.id}`}>{r.number}</A> }, { h: "Supplier", r: (r: any) => r.supplier }, { h: "First due", r: (r: any) => date(r.due), hideSm: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} />
    <Pager page={page} total={d.total} per={PER} base={`/app/purchasing?q=${sp.q ?? ""}&status=${sp.status ?? ""}`} /></Page>;
}
