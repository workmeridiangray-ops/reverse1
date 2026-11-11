import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Flash, Money, PageHeader, Qty, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { lineNet, lineTax } from "@/lib/rules/money";
import { cancelOrder, confirmOrder, dispatchOrder, invoiceOrder, requestPurchases } from "../../actions";
import { requestApproval } from "../../actions2";

export const metadata: Metadata = { title: "Sales order" };

export default async function Order({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; short?: string }> }) {
  const { id } = await params; const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const { data: o } = await sb.from("sales_orders").select("*, customers(name,credit_limit_paise), warehouses(name)").eq("id", id).maybeSingle();
  if (!o) notFound();
  const { data: lines } = await sb.from("sales_order_lines").select("*, items(sku,name,unit,kind)").eq("order_id", id).order("line_no");
  const { data: res } = await sb.from("reservations").select("so_line_id,qty").in("so_line_id", (lines ?? []).map((l: any) => l.id));
  const { data: apps } = await sb.from("approvals").select("status,required_role,decision_reason,amount_paise").eq("subject", "sales_order").eq("subject_id", id).order("created_at", { ascending: false });
  const { data: invs } = await sb.from("invoices").select("id,number,total_paise,status").eq("order_id", id);
  const reserved = (lid: string) => (res ?? []).filter((r: any) => r.so_line_id === lid).reduce((a: number, r: any) => a + Number(r.qty), 0);
  const total = (lines ?? []).reduce((a: number, l: any) => { const n = lineNet(l.qty, Number(l.unit_price_paise), l.discount_bp); return a + n + lineTax(n, l.tax_rate_bp); }, 0);
  const sellRoles = can(ctx.role, "owner", "manager", "sales"); const whRoles = can(ctx.role, "owner", "manager", "warehouse");
  const live = o.status === "confirmed" || o.status === "partially_dispatched";
  const shortLines = (lines ?? []).filter((l: any) => l.items?.kind === "stock" && Number(l.qty) - Number(l.qty_dispatched) - reserved(l.id) > 0);
  const toInvoice = (lines ?? []).some((l: any) => Number(l.qty_dispatched) > Number(l.qty_invoiced));
  return (
    <>
      <PageHeader title={o.number} sub={`${o.customers?.name} · ${o.warehouses?.name} · ${o.order_date}`} actions={<Status value={o.status} />} />
      <Flash ok={q.ok} error={q.error} />
      {q.short && <div role="status" className="mb-4 rounded-md border border-warn bg-warn-bg px-4 py-3 text-warn">{q.short} line(s) are short of stock. Create purchase requests below, or wait for goods to arrive — reservations fill automatically on receipt.</div>}
      <Table head={["#", "Item", "Qty", "Reserved", "Dispatched", "Invoiced", "Unit price", "Disc", "Tax", "Line total"]} numeric={[2, 3, 4, 5, 6, 7, 8, 9]}>
        {(lines ?? []).map((l: any) => { const n = lineNet(l.qty, Number(l.unit_price_paise), l.discount_bp); return (
          <tr key={l.id}><td className="td">{l.line_no}</td><td className="td"><span className="font-mono text-xs">{l.items?.sku}</span> {l.items?.name}</td>
            <td className="td num"><Qty v={l.qty} /> {l.items?.unit}</td><td className="td num"><Qty v={reserved(l.id)} /></td><td className="td num"><Qty v={l.qty_dispatched} /></td><td className="td num"><Qty v={l.qty_invoiced} /></td>
            <td className="td num"><Money paise={Number(l.unit_price_paise)} /></td><td className="td num">{l.discount_bp / 100}%</td><td className="td num">{l.tax_rate_bp / 100}%</td><td className="td num"><Money paise={n + lineTax(n, l.tax_rate_bp)} /></td></tr>); })}
        <tr><td className="td num font-semibold" colSpan={9}>Order total (incl. tax)</td><td className="td num font-semibold"><Money paise={total} /></td></tr>
      </Table>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {o.status === "draft" && sellRoles && (
          <form action={confirmOrder} className="card space-y-3 p-5"><input type="hidden" name="id" value={id} />
            <h2 className="font-semibold">Confirm and reserve stock</h2>
            <p className="text-sm text-muted">Credit limit: {o.customers?.credit_limit_paise == null ? "none" : <Money paise={Number(o.customers.credit_limit_paise)} />}. If this order exceeds it, a manager must give a reason.</p>
            {!!apps?.length && <p className="rounded-md bg-info-bg p-2 text-sm text-info">Approval: {apps[0]!.status}{apps[0]!.status === "pending" ? ` — waiting for a ${apps[0]!.required_role}` : ""}{apps[0]!.decision_reason ? ` (${apps[0]!.decision_reason})` : ""}</p>}
            <label className="block text-sm font-medium" htmlFor="override">Credit override reason (only if needed)</label>
            <input id="override" name="override" className="input" />
            <SubmitButton>Confirm order</SubmitButton></form>
        )}
        {o.status === "draft" && sellRoles && apps?.[0]?.status !== "pending" && (
          <form action={requestApproval} className="card space-y-2 p-5"><input type="hidden" name="subject" value="sales_order" /><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={`/app/sales/${id}`} />
            <h2 className="font-semibold">Needs approval?</h2><p className="text-sm text-muted">If this order is above your company's approval threshold, confirming is blocked until a manager approves. Ask for it here.</p><SubmitButton variant="plain">Request approval</SubmitButton></form>
        )}
        {live && shortLines.length > 0 && can(ctx.role, "owner", "manager", "sales", "purchasing") && (
          <form action={requestPurchases} className="card space-y-3 p-5"><input type="hidden" name="id" value={id} /><h2 className="font-semibold">Shortage</h2>
            <p className="text-sm text-muted">{shortLines.length} line(s) have unreserved quantity. Raise purchase requests for approval.</p><SubmitButton>Request purchases</SubmitButton></form>
        )}
        {live && whRoles && (
          <form action={dispatchOrder} className="card space-y-3 p-5"><input type="hidden" name="id" value={id} /><h2 className="font-semibold">Dispatch</h2>
            <p className="text-sm text-muted">Only reserved quantity can ship.</p>
            {(lines ?? []).filter((l: any) => Number(l.qty) > Number(l.qty_dispatched)).map((l: any) => (
              <label key={l.id} className="flex items-center justify-between gap-3 text-sm"><span>{l.items?.sku} · reserved <Qty v={reserved(l.id)} /> of <Qty v={Number(l.qty) - Number(l.qty_dispatched)} /> open</span>
                <input className="input w-28" name={`d_${l.id}`} inputMode="decimal" placeholder="Qty" aria-label={`Dispatch quantity for ${l.items?.sku}`} /></label>))}
            <label className="block text-sm font-medium" htmlFor="carrier">Carrier / AWB reference</label><input id="carrier" name="carrier" className="input" />
            <SubmitButton>Record dispatch</SubmitButton></form>
        )}
        {toInvoice && can(ctx.role, "owner", "manager", "accountant", "sales") && (
          <form action={invoiceOrder} className="card space-y-3 p-5"><input type="hidden" name="id" value={id} /><h2 className="font-semibold">Invoice dispatched goods</h2><p className="text-sm text-muted">Posts receivable, revenue and GST.</p><SubmitButton>Create invoice</SubmitButton></form>
        )}
        {(o.status === "draft" || o.status === "confirmed") && sellRoles && (
          <form action={cancelOrder} className="card space-y-3 p-5"><input type="hidden" name="id" value={id} /><h2 className="font-semibold">Cancel order</h2>
            <label className="block text-sm font-medium" htmlFor="reason">Reason (required)</label><input id="reason" name="reason" required minLength={3} className="input" /><SubmitButton variant="danger">Cancel order</SubmitButton></form>
        )}
      </div>
      {!!invs?.length && <><h2 className="mb-2 mt-8 font-semibold">Invoices</h2><Table head={["Invoice", "Total", "Status"]} numeric={[1]}>{invs.map((i: any) => <tr key={i.id}><td className="td"><Link className="text-brand underline" href={`/app/invoices/${i.id}`}>{i.number}</Link></td><td className="td num"><Money paise={Number(i.total_paise)} /></td><td className="td"><Status value={i.status} /></td></tr>)}</Table></>}
    </>
  );
}
