import { amountFor, percentOf } from "./qty";

/**
 * Running-bill calculation. Pure.
 *  - Quantities are cumulative: this bill's amount for an item is
 *    amount(prev + this) − amount(prev), so rounding never drifts across bills.
 *  - Submitted (claimed) and certified amounts are computed separately.
 *  - Retention and advance recovery are applied to the certified gross, capped
 *    by the contract's retention cap and the outstanding advance.
 */
export class BillingError extends Error {
  override name = "BillingError";
}

export interface BillLineInput {
  boqItemId: string;
  code?: string;
  rateMinor: number;
  contractQtyMilli: number; // BOQ quantity + approved variation deltas
  prevQtyMilli: number; // certified in earlier bills
  claimedQtyMilli: number;
  certifiedQtyMilli: number;
}
export interface Terms {
  retentionBp: number;
  retentionCapBp: number;
  advanceRecoveryBp: number;
  advanceMinor: number;
  contractValueMinor: number; // revised contract value (incl. approved variations)
}
export interface Prior {
  retentionToDateMinor: number;
  advanceRecoveredToDateMinor: number;
}
export interface BillLineResult extends BillLineInput {
  claimedAmountMinor: number;
  certifiedAmountMinor: number;
}
export interface BillTotals {
  lines: BillLineResult[];
  claimedGrossMinor: number;
  certifiedGrossMinor: number;
  retentionMinor: number;
  advanceRecoveryMinor: number;
  otherDeductionMinor: number;
  netMinor: number;
}

export function computeBill(lines: BillLineInput[], terms: Terms, prior: Prior, otherDeductionMinor = 0): BillTotals {
  if (otherDeductionMinor < 0) throw new BillingError("Other deductions cannot be negative");
  const out: BillLineResult[] = lines.map((l) => {
    if (l.certifiedQtyMilli > l.claimedQtyMilli)
      throw new BillingError(`${l.code ?? l.boqItemId}: certified quantity cannot exceed the claimed quantity`);
    if (l.prevQtyMilli + l.claimedQtyMilli > l.contractQtyMilli)
      throw new BillingError(
        `${l.code ?? l.boqItemId}: cumulative quantity would exceed the contract quantity. Raise and approve a variation first.`,
      );
    const claimed = amountFor(l.prevQtyMilli + l.claimedQtyMilli, l.rateMinor) - amountFor(l.prevQtyMilli, l.rateMinor);
    const certified = amountFor(l.prevQtyMilli + l.certifiedQtyMilli, l.rateMinor) - amountFor(l.prevQtyMilli, l.rateMinor);
    return { ...l, claimedAmountMinor: claimed, certifiedAmountMinor: certified };
  });
  const claimedGross = out.reduce((a, l) => a + l.claimedAmountMinor, 0);
  const certifiedGross = out.reduce((a, l) => a + l.certifiedAmountMinor, 0);

  const retentionCap = percentOf(terms.contractValueMinor, terms.retentionCapBp);
  const retention = Math.max(0, Math.min(percentOf(certifiedGross, terms.retentionBp), retentionCap - prior.retentionToDateMinor));
  const advanceLeft = Math.max(0, terms.advanceMinor - prior.advanceRecoveredToDateMinor);
  const advanceRecovery = Math.min(percentOf(certifiedGross, terms.advanceRecoveryBp), advanceLeft);
  const net = certifiedGross - retention - advanceRecovery - otherDeductionMinor;
  if (net < 0) throw new BillingError("Deductions exceed the certified amount; the bill cannot be negative");
  return {
    lines: out,
    claimedGrossMinor: claimedGross,
    certifiedGrossMinor: certifiedGross,
    retentionMinor: retention,
    advanceRecoveryMinor: advanceRecovery,
    otherDeductionMinor,
    netMinor: net,
  };
}

/** Revised contract value = Σ amount(effective qty, rate). */
export function contractValue(items: Array<{ qtyMilli: number; approvedDeltaMilli: number; rateMinor: number }>): number {
  return items.reduce((a, i) => a + amountFor(i.qtyMilli + i.approvedDeltaMilli, i.rateMinor), 0);
}

export interface CollectionState {
  invoicedMinor: number;
  collectedMinor: number;
  disputedOpenMinor: number;
  outstandingMinor: number;
  undisputedOutstandingMinor: number;
  status: "unpaid" | "part_paid" | "paid" | "overpaid";
}
export function collectionState(invoicedMinor: number, receipts: number[], openDisputes: number[]): CollectionState {
  const collected = receipts.reduce((a, b) => a + b, 0);
  const disputed = openDisputes.reduce((a, b) => a + b, 0);
  const outstanding = invoicedMinor - collected;
  return {
    invoicedMinor,
    collectedMinor: collected,
    disputedOpenMinor: disputed,
    outstandingMinor: outstanding,
    undisputedOutstandingMinor: Math.max(0, outstanding - disputed),
    status: collected === 0 ? "unpaid" : collected < invoicedMinor ? "part_paid" : collected === invoicedMinor ? "paid" : "overpaid",
  };
}

/** A dispute may not exceed what is still outstanding after other open disputes. */
export function maxNewDispute(outstandingMinor: number, openDisputes: number[]): number {
  return Math.max(0, outstandingMinor - openDisputes.reduce((a, b) => a + b, 0));
}
