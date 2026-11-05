import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import { Flash, Money, PageHeader, Qty, Status, Table } from "@/components/ui/kit";

export const metadata: Metadata = { title: "Invoice" };

export default async function Invoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { id } = await params; const q = await searchParams; await requireCtx(); const sb = await createClient();
  const { data: inv } = await sb.from("invoices").select("*, customers(name,gstin), sales_orders(id,number)").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const [{ data: lines }, { data: allocs }, { data: je }] = await Promise.all([
    sb.from("invoice_lines").select("*, items(sku,name)").eq("invoice_id", id),
    sb.from("payment_allocations").select("amount_paise, payments(number,method,payment_date,reference)").eq("invoice_id", id),
    sb.from("journal_entries").select("id,number").eq("source_type", "invoice").eq("source_id", id),
  ]);
  return (
    <>
      <PageHeader title={inv.number} sub={`${inv.customers?.name}${inv.customers?.gstin ? ` · GSTIN ${inv.customers.gstin}` : ""} · ${inv.invoice_date}`} actions={<Status value={inv.status} />} />
      <Flash ok={q.ok} />
      <Table head={["Item", "Qty", "Unit price", "Disc", "Net", "Tax", ]} numeric={[1, 2, 3, 4, 5]}>
        {(lines ?? []).map((l: any) => <tr key={l.id}><td className="td">{l.items?.sku} · {l.items?.name}</td><td className="td num"><Qty v={l.qty} /></td><td className="td num"><Money paise={Number(l.unit_price_paise)} /></td><td className="td num">{l.discount_bp / 100}%</td><td className="td num"><Money paise={Number(l.net_paise)} /></td><td className="td num"><Money paise={Number(l.tax_paise)} /> <span className="text-xs text-muted">@{l.tax_rate_bp / 100}%</span></td></tr>)}
        <tr><td className="td num font-semibold" colSpan={4}>Subtotal / GST / Total</td><td className="td num"><Money paise={Number(inv.subtotal_paise)} /></td><td className="td num"><Money paise={Number(inv.tax_paise)} /></td></tr>
        <tr><td className="td num font-semibold" colSpan={5}>Total</td><td className="td num font-semibold"><Money paise={Number(inv.total_paise)} /></td></tr>
      </Table>
      <p className="mt-3 text-sm text-muted">Order <Link className="underline" href={`/app/sales/${inv.sales_orders?.id}`}>{inv.sales_orders?.number}</Link>{je?.[0] && <> · Posted as journal {je[0].number}</>}</p>
      <h2 className="mb-2 mt-6 font-semibold">Receipts</h2>
      <Table head={["Receipt", "Date", "Method", "Reference", "Amount"]} numeric={[4]}>
        {(allocs ?? []).map((a: any, i: number) => <tr key={i}><td className="td">{a.payments?.number}</td><td className="td">{a.payments?.payment_date}</td><td className="td">{a.payments?.method}</td><td className="td">{a.payments?.reference ?? "—"}</td><td className="td num"><Money paise={Number(a.amount_paise)} /></td></tr>)}
        {!allocs?.length && <tr><td className="td text-muted" colSpan={5}>No receipts yet. Balance <Money paise={Number(inv.total_paise) - Number(inv.paid_paise)} />.</td></tr>}
      </Table>
    </>
  );
}
