import Link from "next/link";
import { SelectField, TextField } from "@/components/ui/Field";
import { DateTimeText, Money } from "@/components/ui/Format";
import { Card, EmptyState } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addBedDays, cancelCharge, captureCharge, generateBill, recordDeposit } from "@/app/(app)/billing/finance-actions";
import type { ServerClient } from "@/lib/supabase/server";

/** Charges, deposits and bill generation for one admission. Admin and reception only. */
export async function AdmissionFinance({ supabase, admissionId, patientId, currency, tz, open }: {
  supabase: ServerClient; admissionId: string; patientId: string; currency: string; tz: string; open: boolean;
}) {
  const [charges, deposits, items, invoices] = await Promise.all([
    supabase.from("charges").select("id, description, unit_price_minor, quantity, status, cancel_reason, invoice_id, captured_at").eq("admission_id", admissionId).order("captured_at"),
    supabase.from("deposits").select("id, amount_minor, applied_minor, refunded_minor, method, reference, received_at").eq("admission_id", admissionId),
    supabase.from("tariff_items").select("code, description, unit_price_minor, tariff_versions!inner(status)").eq("tariff_versions.status", "active").order("code"),
    supabase.from("charges").select("invoice_id").eq("admission_id", admissionId).not("invoice_id", "is", null),
  ]);
  const rows = charges.data ?? [];
  const live = rows.filter((c) => c.status !== "cancelled");
  const total = live.reduce((t, c) => t + Number(c.unit_price_minor) * c.quantity, 0);
  const unbilled = rows.filter((c) => c.status === "captured").length;
  const held = (deposits.data ?? []).reduce((t, d) => t + Number(d.amount_minor) - Number(d.applied_minor) - Number(d.refunded_minor), 0);
  const invIds = [...new Set((invoices.data ?? []).map((i) => i.invoice_id as string))];
  return (
    <Card title="Charges and deposits">
      <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-ink-500">Charges (not cancelled)</dt><dd className="text-right"><Money minor={total} currency={currency} /></dd>
        <dt className="text-ink-500">Deposits held</dt><dd className="text-right"><Money minor={held} currency={currency} /></dd>
      </dl>
      {rows.length === 0 ? <EmptyState title="No charges yet" /> : (
        <ul className="mb-4 divide-y divide-line">{rows.map((c) => (
          <li key={c.id} className="py-2">
            <div className="flex justify-between gap-2"><span className={c.status === "cancelled" ? "line-through text-ink-500" : ""}>{c.quantity} × {c.description}</span><Money minor={Number(c.unit_price_minor) * c.quantity} currency={currency} /></div>
            <p className="text-caption text-ink-500">{c.status === "captured" ? "Not billed yet" : c.status === "billed" ? "On a bill" : `Cancelled: ${c.cancel_reason}`} · <DateTimeText at={c.captured_at} timeZone={tz} /></p>
            {c.status === "captured" ? (
              <form action={cancelCharge} className="mt-1 flex items-end gap-2"><input type="hidden" name="admission_id" value={admissionId} /><input type="hidden" name="charge_id" value={c.id} />
                <TextField label="Reason to cancel" id={`cr-${c.id}`} name="reason" /><SubmitButton size="sm" variant="ghost">Cancel charge</SubmitButton></form>) : null}
          </li>))}</ul>)}
      {open ? (
        <>
          <form action={captureCharge} className="mb-4 grid grid-cols-[1fr_5rem] items-end gap-3">
            <input type="hidden" name="admission_id" value={admissionId} /><input type="hidden" name="patient_id" value={patientId} />
            <SelectField label="Add a charge" id="ch-code" name="code"><option value="">Choose from the tariff…</option>
              {(items.data ?? []).map((i) => <option key={i.code} value={i.code}>{i.code} · {i.description}</option>)}</SelectField>
            <TextField label="Qty" id="ch-qty" name="quantity" defaultValue="1" inputMode="numeric" />
            <SubmitButton size="sm" variant="secondary">Add charge</SubmitButton>
          </form>
          <form action={addBedDays} className="mb-4"><input type="hidden" name="admission_id" value={admissionId} /><SubmitButton size="sm" variant="secondary">Add bed-days to date</SubmitButton></form>
        </>) : null}
      <form action={generateBill} className="mb-4"><input type="hidden" name="admission_id" value={admissionId} /><input type="hidden" name="patient_id" value={patientId} />
        <SubmitButton disabled={unbilled === 0}>Create bill from {unbilled} unbilled charge{unbilled === 1 ? "" : "s"}</SubmitButton></form>
      {invIds.length ? <p className="mb-4 text-sm">Bills: {invIds.map((i, n) => <span key={i}>{n ? ", " : ""}<Link href={`/billing/${i}`}>invoice {n + 1}</Link></span>)}</p> : null}
      <h3 className="mb-2 font-bold">Deposits</h3>
      <ul className="mb-3 text-sm">{(deposits.data ?? []).map((d) => (
        <li key={d.id}>{d.reference}: <Money minor={Number(d.amount_minor)} currency={currency} /> ({d.method}) · applied <Money minor={Number(d.applied_minor)} currency={currency} />{Number(d.refunded_minor) ? <> · refunded <Money minor={Number(d.refunded_minor)} currency={currency} /></> : null}</li>))}</ul>
      <form action={recordDeposit} className="grid grid-cols-2 items-end gap-3">
        <input type="hidden" name="admission_id" value={admissionId} /><input type="hidden" name="patient_id" value={patientId} />
        <TextField label="Amount" id="dp-amount" name="amount" inputMode="decimal" />
        <SelectField label="Paid by" id="dp-method" name="method"><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></SelectField>
        <div className="col-span-2"><TextField label="Receipt reference" id="dp-ref" name="reference" hint="e.g. DEP-1042" /></div>
        <SubmitButton size="sm" variant="secondary">Record deposit</SubmitButton>
      </form>
    </Card>
  );
}
