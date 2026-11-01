import "server-only";
import { type InsuranceStatus, type InvoiceState, type PaymentStatus, summarizeInvoice } from "@/lib/rules/invoice";
import type { ServerClient } from "@/lib/supabase/server";

/**
 * Load an invoice with its database-computed balance (invoice_balances) and
 * recompute the same figures with lib/rules/invoice. `parityOk` is false if
 * the two ever disagree, so the UI can refuse to take money on bad numbers.
 */
export async function getInvoice(supabase: ServerClient, id: string) {
  const [inv, bal, lines, payments] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, patient:patients!invoices_patient_id_clinic_id_fkey(id, given_name, family_name, mrn)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(),
    supabase.from("invoice_lines").select("id, description, quantity, unit_price_minor").eq("invoice_id", id).order("created_at"),
    supabase.from("payments").select("id, amount_minor, method, reference, received_at, receiver:profiles!payments_received_by_fkey(full_name)").eq("invoice_id", id).order("received_at"),
  ]);
  if (!inv.data || !bal.data) return null;
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const balance = {
    totalMinor: n(bal.data.total_minor),
    patientPaidMinor: n(bal.data.patient_paid_minor),
    insurancePaidMinor: n(bal.data.insurance_paid_minor),
    insuranceAdjustmentMinor: n(bal.data.insurance_adjustment_minor),
    patientResponsibilityMinor: n(bal.data.patient_responsibility_minor),
    balanceDueMinor: n(bal.data.balance_due_minor),
    patientDueNowMinor: n(bal.data.patient_due_now_minor),
    status: bal.data.payment_status as PaymentStatus,
  };
  const ts = summarizeInvoice({
    state: inv.data.state as InvoiceState,
    lines: (lines.data ?? []).map((l) => ({ quantity: l.quantity, unitPriceMinor: n(l.unit_price_minor) })),
    paymentsMinor: inv.data.state === "issued" ? (payments.data ?? []).map((p) => n(p.amount_minor)) : [],
    insuranceStatus: inv.data.insurance_status as InsuranceStatus,
    insuranceClaimedMinor: n(inv.data.insurance_claimed_minor),
    insurancePaidMinor: n(inv.data.insurance_paid_minor),
  });
  const parityOk = (Object.keys(balance) as Array<keyof typeof balance>).every((k) => balance[k] === ts[k]);
  return { invoice: inv.data, balance, lines: lines.data ?? [], payments: payments.data ?? [], parityOk };
}
