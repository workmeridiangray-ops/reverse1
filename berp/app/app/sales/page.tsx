import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Flash, LinkBtn, PageHeader, Status, Table } from "@/components/ui/kit";

export const metadata: Metadata = { title: "Sales orders" };
const STATUSES = ["draft", "confirmed", "partially_dispatched", "dispatched", "invoiced", "cancelled"];

export default async function Sales({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; status?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  let query = sb.from("sales_orders").select("id,number,status,order_date,customers(name),warehouses(name)").order("created_at", { ascending: false }).limit(100);
  if (q.status && STATUSES.includes(q.status)) query = query.eq("status", q.status);
  const { data } = await query;
  return (
    <>
      <PageHeader title="Sales orders" actions={can(ctx.role, "owner", "manager", "sales") && <LinkBtn primary href="/app/sales/new">New order</LinkBtn>} />
      <Flash ok={q.ok} error={q.error} />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        <Link className={`btn ${!q.status ? "btn-primary" : ""}`} href="/app/sales">All</Link>
        {STATUSES.map((s) => <Link key={s} className={`btn ${q.status === s ? "btn-primary" : ""}`} href={`/app/sales?status=${s}`}>{s.replace(/_/g, " ")}</Link>)}
      </nav>
      {data?.length ? (
        <Table head={["Order", "Customer", "Warehouse", "Date", "Status"]}>
          {data.map((o: any) => <tr key={o.id}><td className="td"><Link className="font-medium text-brand underline" href={`/app/sales/${o.id}`}>{o.number}</Link></td><td className="td">{o.customers?.name}</td><td className="td">{o.warehouses?.name}</td><td className="td">{o.order_date}</td><td className="td"><Status value={o.status} /></td></tr>)}
        </Table>
      ) : <Empty title="No orders found" hint="Create an order to reserve stock and start the sale." />}
    </>
  );
}
