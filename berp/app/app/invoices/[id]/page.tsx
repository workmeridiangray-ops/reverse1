import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import { Flash, Money, PageHeader, Qty, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createCreditNote } from "../../actions2";

export const metadata: Metadata = { title: "Invoice" };

export default async function Invoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params; const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const { data: inv } = await sb.from("invoices").select("*, customers(name,gstin), sales_orders(id,number)").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const [{ data: lines }, { data: allocs }, { data: je }, { data: cns }, { data: cnl }] = await Promise.all([
    sb.from("invoice_lines").select("*, items(sku,name)").eq("invoice_id", id),
    sb.from("payment_allocations").select("amount_paise, payments(number,method,payment_date,reference)").eq("invoice_id", id),
    sb.from("journal_entries").select("id,number").eq("source_type", "invoice").eq("source_id", id),
    sb.from("credit_notes").select("*").eq("invoice_id", id).order("created_at"),
    sb.from("credit_note_lines").select("invoice_line_id,qty"),
  ]);
  const credited = (lid: string) => (cnl ?? []).filter((x: any) => x.invoice_line_id === lid).reduce((a: number, x: any) => a + Number(x.qty), 0);
  const balance = Number(inv.total_paise) - Number(inv.paid_paise) - Number(inv.credited_paise);
  const canCredit = ["owner", "manager", "accountant"].includes(ctx.role) && balance > 0;
  return (
    <>
      <PageHeader title={inv.number} sub={`${inv.customers?.name}${inv.customers?.gstin ? ` · GSTIN ${inv.customers.gstin}` : ""} · ${inv.invoice_date}`} actions={<Status value={inv.status} />} />
      <Flash ok={q.ok} error={q.error} />
      <Table head={["Item", "Qty", "Unit price", "Disc", "Net", "Tax"]} numeric={[1, 2, 3, 4, 5]}>
        {(lines ?? []).map((l: any) => <tr key={l.id}><td className="td">{l.items?.sku} · {l.items?.name}</td><td className="td num"><Qty v={l.qty} /></td><td className="td num"><Money paise={Number(l.unit_price_paise)} /></td><td className="td num">{l.discount_bp / 100}%</td><td className="td num"><Money paise={Number(l.net_paise)} /></td><td className="td num"><Money paise={Number(l.tax_paise)} /> <span className="text-xs text-muted">@{l.tax_rate_bp / 100}%</span></td></tr>)}
        <tr><td className="td num font-semibold" colSpan={4}>Subtotal / GST / Total</td><td className="td num"><Money paise={Number(inv.subtotal_paise)} /></td><td className="td num"><Money paise={Number(inv.tax_paise)} /></td></tr>
        <tr><td className="td num font-semibold" colSpan={5}>Total</td><td className="td num font-semibold"><Money paise={Number(inv.total_paise)} /></td></tr>
      </Table>
      <p className="mt-3 text-sm text-muted">Order <Link className="underline" href={`/app/sales/${inv.sales_orders?.id}`}>{inv.sales_orders?.number}</Link>{je?.[0] && <> · Posted as journal {je[0].number}</>}</p>
      <h2 className="mb-2 mt-6 font-semibold">Receipts</h2>
      <Table head={["Receipt", "Date", "Method", "Reference", "Amount"]} numeric={[4]}>
        {(allocs ?? []).map((a: any, i: number) => <tr key={i}><td className="td">{a.payments?.number}</td><td className="td">{a.payments?.payment_date}</td><td className="td">{a.payments?.method}</td><td className="td">{a.payments?.reference ?? "—"}</td><td className="td num"><Money paise={Number(a.amount_paise)} /></td></tr>)}
        {!allocs?.length && <tr><td className="td text-muted" colSpan={5}>No receipts yet. Balance <Money paise={balance} />.</td></tr>}
      </Table>
      {!!cns?.length && <><h2 className="mb-2 mt-6 font-semibold">Credit notes</h2><Table head={["Credit note", "Reason", "Restocked", "Amount"]} numeric={[3]}>{cns.map((c: any) => <tr key={c.id}><td className="td">{c.number}</td><td className="td">{c.reason}</td><td className="td">{c.restocked ? "Yes" : "No"}</td><td className="td num"><Money paise={Number(c.total_paise)} /></td></tr>)}</Table></>}
      {canCredit && (
        <form action={createCreditNote} className="card mt-6 space-y-3 p-5"><input type="hidden" name="invoice" value={id} /><h2 className="font-semibold">Issue a credit note / customer return</h2>
          <p className="text-sm text-muted">Balance still owed: <Money paise={balance} />. Credit cannot exceed it; if the customer has already paid, record a refund separately.</p>
          {(lines ?? []).map((l: any) => <label key={l.id} className="flex items-center justify-between gap-3 text-sm"><span>{l.items?.sku} · creditable <Qty v={Number(l.qty) - credited(l.id)} /></span><input name={`q_${l.id}`} inputMode="decimal" placeholder="Qty" aria-label={`Quantity to credit for ${l.items?.sku}`} className="input w-28" /></label>)}
          <label className="block text-sm font-medium" htmlFor="reason">Reason (required)</label><input id="reason" name="reason" required minLength={3} className="input" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restock" defaultChecked className="h-5 w-5" /> Goods came back and go into stock (reverses cost of goods)</label>
          <SubmitButton>Issue credit note</SubmitButton></form>)}
    </>
  );
}
