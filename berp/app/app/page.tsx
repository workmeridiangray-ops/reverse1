import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Flash, Money, PageHeader, Status, Table } from "@/components/ui/kit";

export const metadata: Metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams;
  const ctx = await requireCtx();
  const sb = await createClient();
  const finance = ["owner", "manager", "accountant", "viewer"].includes(ctx.role);
  const [orders, prs, stock, inv, tb] = await Promise.all([
    sb.from("sales_orders").select("id,number,status,order_date,customers(name)").in("status", ["draft", "confirmed", "partially_dispatched", "dispatched"]).order("created_at", { ascending: false }).limit(8),
    sb.from("purchase_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("stock_levels").select("sku,item_name,warehouse_name,on_hand,reserved,reorder_level"),
    finance ? sb.from("invoices").select("total_paise,paid_paise,status").neq("status", "reversed") : Promise.resolve({ data: [] as any[] }),
    finance ? sb.from("trial_balance").select("code,name,balance_paise").in("code", ["1000"]) : Promise.resolve({ data: [] as any[] }),
  ]);
  const low = (stock.data ?? []).filter((s: any) => Number(s.on_hand) - Number(s.reserved) <= Number(s.reorder_level) && Number(s.reorder_level) > 0);
  const receivable = (inv.data ?? []).reduce((a: number, i: any) => a + (Number(i.total_paise) - Number(i.paid_paise)), 0);
  const cash = (tb.data ?? [])[0]?.balance_paise ?? 0;
  const Kpi = ({ label, value, href }: { label: string; value: React.ReactNode; href: string }) => (
    <Link href={href} className="card block p-4 hover:bg-canvas"><p className="text-sm text-muted">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></Link>
  );
  return (
    <>
      <PageHeader title="Overview" sub={ctx.tenant.name} />
      <Flash ok={q.ok} error={q.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {finance && <Kpi label="Receivables outstanding" value={<Money paise={receivable} />} href="/app/invoices" />}
        {finance && <Kpi label="Cash and bank" value={<Money paise={Number(cash)} />} href="/app/finance" />}
        <Kpi label="Purchase requests awaiting approval" value={prs.count ?? 0} href="/app/purchasing" />
        <Kpi label="Items at or below reorder level" value={low.length} href="/app/inventory" />
      </div>
      <h2 className="mb-2 mt-8 font-semibold">Open sales orders</h2>
      <Table head={["Order", "Customer", "Date", "Status"]}>
        {(orders.data ?? []).map((o: any) => (
          <tr key={o.id}><td className="td"><Link className="font-medium text-brand underline" href={`/app/sales/${o.id}`}>{o.number}</Link></td><td className="td">{o.customers?.name}</td><td className="td">{o.order_date}</td><td className="td"><Status value={o.status} /></td></tr>
        ))}
        {!orders.data?.length && <tr><td className="td text-muted" colSpan={4}>No open orders. <Link className="underline" href="/app/sales/new">Create the first one.</Link></td></tr>}
      </Table>
    </>
  );
}
