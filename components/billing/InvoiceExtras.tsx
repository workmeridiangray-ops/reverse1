import { TextField } from "@/components/ui/Field";
import { Money } from "@/components/ui/Format";
import { Card } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { applyDeposit, requestRefund } from "@/app/(app)/billing/finance-actions";
import type { ServerClient } from "@/lib/supabase/server";

/** Apply held deposits and request refunds against one issued invoice. */
export async function InvoiceExtras({ supabase, invoiceId, patientId, currency, paidMinor, dueNow }: {
  supabase: ServerClient; invoiceId: string; patientId: string; currency: string; paidMinor: number; dueNow: number;
}) {
  const [deps, refunds] = await Promise.all([
    supabase.from("deposits").select("id, reference, amount_minor, applied_minor, refunded_minor").eq("patient_id", patientId),
    supabase.from("refunds").select("amount_minor, status").eq("invoice_id", invoiceId),
  ]);
  const usable = (deps.data ?? []).filter((d) => Number(d.amount_minor) - Number(d.applied_minor) - Number(d.refunded_minor) > 0);
  const approved = (refunds.data ?? []).filter((r) => r.status === "approved").reduce((t, r) => t + Number(r.amount_minor), 0);
  const pending = (refunds.data ?? []).filter((r) => r.status === "requested").reduce((t, r) => t + Number(r.amount_minor), 0);
  return (
    <>
      {usable.length && dueNow > 0 ? (
        <Card title="Apply a deposit" as="aside">
          {usable.map((d) => (
            <form key={d.id} action={applyDeposit} className="mb-2 flex items-center justify-between gap-3">
              <input type="hidden" name="invoice_id" value={invoiceId} /><input type="hidden" name="deposit_id" value={d.id} />
              <span>{d.reference}: <Money minor={Number(d.amount_minor) - Number(d.applied_minor) - Number(d.refunded_minor)} currency={currency} /> left</span>
              <SubmitButton size="sm" variant="secondary">Apply</SubmitButton>
            </form>))}
        </Card>) : null}
      {paidMinor - approved - pending > 0 ? (
        <Card title="Refund" as="aside">
          <p className="mb-3 text-sm text-ink-700">Collected net of refunds: <Money minor={paidMinor - approved} currency={currency} />{pending ? <> · pending <Money minor={pending} currency={currency} /></> : null}. A second person approves before it counts.</p>
          <form action={requestRefund} className="flex flex-col gap-3"><input type="hidden" name="invoice_id" value={invoiceId} />
            <TextField label="Amount" id="rf-amount" name="amount" inputMode="decimal" /><TextField label="Reason" id="rf-reason" name="reason" />
            <SubmitButton variant="secondary">Request refund</SubmitButton></form>
        </Card>) : approved ? <p className="text-sm text-ink-500">Refunded so far: <Money minor={approved} currency={currency} />.</p> : null}
    </>
  );
}
