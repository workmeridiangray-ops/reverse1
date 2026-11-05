import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Flash, Money, PageHeader, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { receivePayment } from "../actions";

export const metadata: Metadata = { title: "Invoices & receipts" };

export default async function Invoices({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; customer?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const { data } = await sb.from("invoices").select("*, customers(name)").order("created_at", { ascending: false }).limit(100);
  const open = (data ?? []).filter((i: any) => ["posted", "partially_paid"].includes(i.status));
  const byCust = new Map<string, any[]>();
  for (const i of open) byCust.set(i.customer_id, [...(byCust.get(i.customer_id) ?? []), i]);
  const cust = q.customer && byCust.has(q.customer) ? q.customer : undefined;
  const canPay = can(ctx.role, "owner", "accountant", "sales");
  return (
    <>
      <PageHeader title="Invoices & receipts" />
      <Flash ok={q.ok} error={q.error} />
      {data?.length ? (
        <Table head={["Invoice", "Customer", "Date", "Total", "Paid", "Balance", "Status"]} numeric={[3, 4, 5]}>
          {data.map((i: any) => <tr key={i.id}><td className="td"><Link className="font-medium text-brand underline" href={`/app/invoices/${i.id}`}>{i.number}</Link></td><td className="td">{i.customers?.name}</td><td className="td">{i.invoice_date}</td>
            <td className="td num"><Money paise={Number(i.total_paise)} /></td><td className="td num"><Money paise={Number(i.paid_paise)} /></td><td className="td num"><Money paise={Number(i.total_paise) - Number(i.paid_paise)} /></td><td className="td"><Status value={i.status} /></td></tr>)}
        </Table>
      ) : <Empty title="No invoices yet" hint="Invoices are created from dispatched sales orders." />}
      {canPay && byCust.size > 0 && (
        <section className="card mt-6 p-6" aria-labelledby="rcpt">
          <h2 id="rcpt" className="font-semibold">Record a customer receipt</h2>
          {!cust ? (
            <form className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm">Customer<select name="customer" className="input mt-1">{[...byCust.entries()].map(([id, l]) => <option key={id} value={id}>{l[0].customers?.name}</option>)}</select></label><button className="btn">Choose</button></form>
          ) : (
            <form action={receivePayment} className="mt-3 space-y-3"><input type="hidden" name="customer" value={cust} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Method<select name="method" className="input mt-1"><option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option></select></label>
                <label className="text-sm">Reference<input name="reference" className="input mt-1" placeholder="UTR / cheque no." /></label>
              </div>
              {byCust.get(cust)!.map((i: any) => (
                <label key={i.id} className="flex items-center justify-between gap-3 text-sm"><span>{i.number} · balance <Money paise={Number(i.total_paise) - Number(i.paid_paise)} /></span>
                  <input name={`a_${i.id}`} inputMode="decimal" className="input w-36" placeholder="Allocate ₹" aria-label={`Amount to allocate to ${i.number}`} /></label>))}
              <SubmitButton>Record receipt</SubmitButton></form>
          )}
        </section>
      )}
    </>
  );
}
