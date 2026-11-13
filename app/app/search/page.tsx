import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, A, Empty } from "@/components/ui";
import { can } from "@/lib/server/perms";
import { redirect } from "next/navigation";
export const metadata = { title: "Search" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany(); const q = (await searchParams).q?.trim() ?? ""; const r = a.membership.role;
  if (q.length >= 2) {   // scanner / exact code: jump straight to the record
    const hit = await rd(a, async (c) => ({ item: can(r, "master.read") ? (await c.query("select id from items where upper(code)=upper($1)", [q])).rows[0] : null, batch: can(r, "inv.read") ? (await c.query("select id from batches where upper(code)=upper($1) limit 2", [q])).rows : [] }));
    if (hit.item) redirect(`/app/items/${hit.item.id}`); if (hit.batch.length === 1) redirect(`/app/trace?batch=${hit.batch[0].id}`);
  }
  const d = q.length < 2 ? null : await rd(a, async (c) => { const l = `%${q}%`; return {
    items: can(r, "master.read") ? (await c.query("select id, code, name from items where code ilike $1 or name ilike $1 limit 10", [l])).rows : [],
    so: can(r, "sales.read") ? (await c.query("select o.id, o.number, cu.name from sales_orders o join customers cu on cu.id=o.customer_id where o.number ilike $1 or cu.name ilike $1 limit 10", [l])).rows : [],
    wo: can(r, "prod.read") ? (await c.query("select w.id, w.number, i.code from work_orders w join items i on i.id=w.item_id where w.number ilike $1 or i.code ilike $1 limit 10", [l])).rows : [],
    po: can(r, "proc.read") ? (await c.query("select p.id, p.number, s.name from purchase_orders p join suppliers s on s.id=p.supplier_id where p.number ilike $1 or s.name ilike $1 limit 10", [l])).rows : [],
    ba: can(r, "inv.read") ? (await c.query("select b.id, b.code, i.code ic from batches b join items i on i.id=b.item_id where b.code ilike $1 limit 10", [l])).rows : [] }; });
  return <Page title={`Search${q ? `: “${q}”` : ""}`}>{!d ? <Empty>Type at least two characters in the search box.</Empty> : <div className="grid gap-4 md:grid-cols-2">
    <Card title="Items">{d.items.length ? d.items.map((x: any) => <div key={x.id}><A href={`/app/items/${x.id}`}>{x.code}</A> {x.name}</div>) : <p className="text-sm text-muted">None</p>}</Card>
    <Card title="Customer orders">{d.so.length ? d.so.map((x: any) => <div key={x.id}><A href={`/app/sales/${x.id}`}>{x.number}</A> {x.name}</div>) : <p className="text-sm text-muted">None</p>}</Card>
    <Card title="Work orders">{d.wo.length ? d.wo.map((x: any) => <div key={x.id}><A href={`/app/production/${x.id}`}>{x.number}</A> {x.code}</div>) : <p className="text-sm text-muted">None</p>}</Card>
    <Card title="Purchase orders">{d.po.length ? d.po.map((x: any) => <div key={x.id}><A href={`/app/purchasing/${x.id}`}>{x.number}</A> {x.name}</div>) : <p className="text-sm text-muted">None</p>}</Card>
    <Card title="Batches">{d.ba.length ? d.ba.map((x: any) => <div key={x.id}><A href={`/app/trace?batch=${x.id}`}>{x.code}</A> {x.ic}</div>) : <p className="text-sm text-muted">None</p>}</Card></div>}</Page>;
}
