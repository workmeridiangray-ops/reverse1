/**
 * Invoice arithmetic and payment status. Pure and dependency-free.
 *
 * PARITY: this module is mirrored by the SQL function
 * `app.invoice_payment_status` and the view `public.invoice_balances` in
 * supabase/migrations. tests/db/money-parity.test.ts runs the same rows through
 * both and fails if they ever disagree. Change both together.
 *
 * Insurance model:
 *  - `insuranceClaimedMinor` is the part of the invoice billed to the insurer.
 *    The patient is responsible for `total - claimed`.
 *  - While a claim is `pending`, the claimed part is neither paid nor owed by
 *    the patient yet.
 *  - When a claim is `settled`, the claimed part is closed: whatever the
 *    insurer paid, the difference is a contractual adjustment, not patient debt.
 *    (This is the case that would otherwise leave invoices "partially paid"
 *    forever.)
 *  - When a claim is `denied`, the claimed part falls back to the patient.
 */
import { assertNonNegative, lineTotal, sum, type Minor } from "./money";

export type InvoiceState = "draft" | "issued" | "void";
export type InsuranceStatus = "none" | "pending" | "settled" | "denied";

export type PaymentStatus =
  | "draft"
  | "void"
  | "unpaid"
  | "partially_paid"
  | "awaiting_insurance"
  | "paid"
  | "overpaid";

export interface InvoiceLineInput {
  quantity: number;
  unitPriceMinor: Minor;
}

export interface InvoiceInput {
  state: InvoiceState;
  lines: readonly InvoiceLineInput[];
  /** Patient payments only. Each must be > 0. */
  paymentsMinor: readonly Minor[];
  insuranceStatus: InsuranceStatus;
  insuranceClaimedMinor: Minor;
  insurancePaidMinor: Minor;
}

export interface InvoiceSummary {
  totalMinor: Minor;
  patientPaidMinor: Minor;
  insurancePaidMinor: Minor;
  /** Claimed minus insurer paid, written off on settlement. 0 otherwise. */
  insuranceAdjustmentMinor: Minor;
  /** What the patient is responsible for given the current claim state. */
  patientResponsibilityMinor: Minor;
  /** Amount still owed by anyone. Negative means credit due to the patient. */
  balanceDueMinor: Minor;
  /** Amount the patient should pay right now (never negative). */
  patientDueNowMinor: Minor;
  status: PaymentStatus;
}

export class InvoiceError extends Error {
  override name = "InvoiceError";
}

export function invoiceTotal(lines: readonly InvoiceLineInput[]): Minor {
  return sum(lines.map((l) => lineTotal(l.quantity, l.unitPriceMinor)));
}

/** Status from already-aggregated figures. Mirrors app.invoice_payment_status. */
export function paymentStatus(args: {
  state: InvoiceState;
  totalMinor: Minor;
  patientPaidMinor: Minor;
  insuranceStatus: InsuranceStatus;
  insuranceClaimedMinor: Minor;
}): PaymentStatus {
  const { state, totalMinor, patientPaidMinor, insuranceStatus, insuranceClaimedMinor } = args;
  if (state === "void") return "void";
  if (state === "draft") return "draft";

  const claimed = insuranceStatus === "none" ? 0 : insuranceClaimedMinor;

  if (insuranceStatus === "pending") {
    const patientPart = totalMinor - claimed;
    if (patientPaidMinor > totalMinor) return "overpaid";
    if (patientPaidMinor >= patientPart) return "awaiting_insurance";
    return patientPaidMinor > 0 ? "partially_paid" : "unpaid";
  }

  const closedByInsurer = insuranceStatus === "settled" ? claimed : 0;
  const due = totalMinor - patientPaidMinor - closedByInsurer;
  if (due < 0) return "overpaid";
  if (due === 0) return "paid";
  return patientPaidMinor > 0 || closedByInsurer > 0 ? "partially_paid" : "unpaid";
}

export function validateInsurance(totalMinor: Minor, claimed: Minor, insurerPaid: Minor): string[] {
  const issues: string[] = [];
  assertNonNegative(claimed, "insurance claimed");
  assertNonNegative(insurerPaid, "insurance paid");
  if (claimed > totalMinor) issues.push("Insurance claim cannot exceed the invoice total.");
  if (insurerPaid > claimed) issues.push("Insurer payment cannot exceed the amount claimed.");
  return issues;
}

export function summarizeInvoice(input: InvoiceInput): InvoiceSummary {
  const totalMinor = invoiceTotal(input.lines);
  for (const p of input.paymentsMinor) {
    assertNonNegative(p, "payment");
    if (p === 0) throw new InvoiceError("Payments must be greater than zero");
  }
  const patientPaidMinor = sum(input.paymentsMinor);
  const ins = input.insuranceStatus;
  const claimed = ins === "none" ? 0 : input.insuranceClaimedMinor;
  const insurerPaid = ins === "settled" ? input.insurancePaidMinor : 0;
  const issues = validateInsurance(totalMinor, claimed, ins === "none" ? 0 : input.insurancePaidMinor);
  if (issues.length > 0) throw new InvoiceError(issues.join(" "));

  const insuranceAdjustmentMinor = ins === "settled" ? claimed - insurerPaid : 0;
  const patientResponsibilityMinor = ins === "pending" || ins === "settled" ? totalMinor - claimed : totalMinor;
  const balanceDueMinor =
    input.state === "issued"
      ? ins === "settled"
        ? totalMinor - claimed - patientPaidMinor
        : totalMinor - patientPaidMinor
      : 0;
  const patientDueNowMinor =
    input.state === "issued" ? Math.max(0, patientResponsibilityMinor - patientPaidMinor) : 0;

  return {
    totalMinor,
    patientPaidMinor,
    insurancePaidMinor: insurerPaid,
    insuranceAdjustmentMinor,
    patientResponsibilityMinor,
    balanceDueMinor,
    patientDueNowMinor,
    status: paymentStatus({
      state: input.state,
      totalMinor,
      patientPaidMinor,
      insuranceStatus: ins,
      insuranceClaimedMinor: claimed,
    }),
  };
}

/** Can a payment of this size be recorded right now? Returns reasons if not. */
export function validatePayment(
  summary: Pick<InvoiceSummary, "status" | "patientDueNowMinor">,
  amountMinor: Minor,
): string[] {
  const issues: string[] = [];
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) issues.push("Payment must be greater than zero.");
  if (summary.status === "draft") issues.push("Issue the invoice before taking payment.");
  if (summary.status === "void") issues.push("This invoice is void.");
  if (issues.length === 0 && amountMinor > summary.patientDueNowMinor) {
    issues.push("Payment is more than the patient currently owes.");
  }
  return issues;
}

/** Statuses where the patient still owes money right now (reception warning). */
export function patientOwesNow(status: PaymentStatus): boolean {
  return status === "unpaid" || status === "partially_paid";
}
