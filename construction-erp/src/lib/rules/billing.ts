import { RuleError, bpOf, lineAmount, max, min, sum } from './money';

export interface BillLineInput {
  boqItemId: string;
  ratePaise: bigint;
  boqQtyMilli: bigint;      // approved BOQ quantity (incl. approved variations)
  prevCumMilli: bigint;     // quantity already billed in earlier non-rejected bills
  thisMilli: bigint;        // quantity claimed in this bill
  certifiedThisMilli?: bigint; // quantity certified (<= thisMilli); defaults to thisMilli
}
export interface ContractTerms { advanceRecoveryBp: number; retentionBp: number; }
export interface PriorState {
  cumGrossPaise: bigint;        // cumulative gross certified in earlier bills
  cumAdvanceRecoveredPaise: bigint;
  cumRetentionPaise: bigint;
  advancePaidPaise: bigint;     // total advance paid to the contractor (cap on recovery)
}
export interface BillLineResult extends BillLineInput {
  cumMilli: bigint; amountSubmitted: bigint; amountCertified: bigint; certifiedMilli: bigint;
}
export interface BillResult {
  lines: BillLineResult[];
  submittedPaise: bigint;           // gross of this-bill claimed quantities
  thisCertifiedGrossPaise: bigint;  // gross of this-bill certified quantities
  cumGrossPaise: bigint;            // cumulative gross certified including this bill
  cumAdvanceRecoveryPaise: bigint;
  cumRetentionPaise: bigint;
  thisAdvanceRecoveryPaise: bigint;
  thisRetentionPaise: bigint;
  netPayablePaise: bigint;          // payable for THIS bill
}

/** Validate claimed quantities against the BOQ: cumulative billing can never pass the BOQ quantity. */
export function validateClaim(l: BillLineInput): void {
  if (l.thisMilli < 0n) throw new RuleError('quantity cannot be negative');
  if (l.prevCumMilli + l.thisMilli > l.boqQtyMilli)
    throw new RuleError(`cumulative quantity exceeds BOQ quantity for ${l.boqItemId}; raise an approved variation first`, 'over_boq');
}

/**
 * Running account bill:
 *   cumulative gross  = previous certified gross + this bill's certified gross
 *   advance recovery  = % of cumulative gross, capped at advance actually paid
 *   retention         = % of cumulative gross
 *   net this bill     = (cum gross - cum recovery - cum retention) - what earlier bills already made payable
 */
export function computeBill(lines: BillLineInput[], terms: ContractTerms, prior: PriorState): BillResult {
  const out: BillLineResult[] = lines.map(l => {
    validateClaim(l);
    const certifiedMilli = l.certifiedThisMilli ?? l.thisMilli;
    if (certifiedMilli < 0n || certifiedMilli > l.thisMilli) throw new RuleError('certified quantity must be between 0 and the claimed quantity', 'cert_range');
    return { ...l, cumMilli: l.prevCumMilli + certifiedMilli, certifiedMilli,
      amountSubmitted: lineAmount(l.thisMilli, l.ratePaise), amountCertified: lineAmount(certifiedMilli, l.ratePaise) };
  });
  const submittedPaise = sum(out.map(l => l.amountSubmitted));
  const thisCertifiedGrossPaise = sum(out.map(l => l.amountCertified));
  const cumGrossPaise = prior.cumGrossPaise + thisCertifiedGrossPaise;
  const cumAdvanceRecoveryPaise = min(bpOf(cumGrossPaise, terms.advanceRecoveryBp), prior.advancePaidPaise);
  const cumRetentionPaise = bpOf(cumGrossPaise, terms.retentionBp);
  const priorNet = prior.cumGrossPaise - prior.cumAdvanceRecoveredPaise - prior.cumRetentionPaise;
  const cumNet = cumGrossPaise - cumAdvanceRecoveryPaise - cumRetentionPaise;
  return {
    lines: out, submittedPaise, thisCertifiedGrossPaise, cumGrossPaise, cumAdvanceRecoveryPaise, cumRetentionPaise,
    thisAdvanceRecoveryPaise: cumAdvanceRecoveryPaise - prior.cumAdvanceRecoveredPaise,
    thisRetentionPaise: cumRetentionPaise - prior.cumRetentionPaise,
    netPayablePaise: max(0n, cumNet - priorNet),
  };
}

export type InvoiceStatus = 'issued' | 'part_paid' | 'paid' | 'disputed' | 'settled';
/** Status from amounts: disputed amounts stay visible; collected never exceeds the invoice. */
export function invoiceStatus(amount: bigint, collected: bigint, openDispute: bigint, writtenOff: bigint = 0n): InvoiceStatus {
  if (collected + writtenOff > amount) throw new RuleError('collected exceeds invoice');
  if (collected + writtenOff === amount) return writtenOff > 0n ? 'settled' : 'paid';
  if (openDispute > 0n) return 'disputed';
  return collected > 0n ? 'part_paid' : 'issued';
}

export interface VariationItem { qtyMilli: bigint; ratePaise: bigint; baseRatePaise?: bigint }
/** Variation items priced on an existing BOQ line must use that line's ORIGINAL contract rate. */
export function variationCost(items: VariationItem[]): bigint {
  return sum(items.map(i => {
    if (i.baseRatePaise !== undefined && i.baseRatePaise !== i.ratePaise)
      throw new RuleError('variation on an existing BOQ item must use the original contract rate', 'rate_locked');
    return lineAmount(i.qtyMilli, i.ratePaise);
  }));
}

/** Final account position: what is still owed either way. */
export function finalAccount(a: {
  contractValue: bigint; approvedVariations: bigint; certifiedGross: bigint; advancePaid: bigint; advanceRecovered: bigint;
  retentionHeld: bigint; invoiced: bigint; collected: bigint; openDisputes: bigint; pendingVariations: bigint;
}) {
  const revisedValue = a.contractValue + a.approvedVariations;
  return {
    revisedValue,
    unbilled: max(0n, revisedValue - a.certifiedGross),
    advanceUnrecovered: max(0n, a.advancePaid - a.advanceRecovered),
    retentionHeld: a.retentionHeld,
    receivable: a.invoiced - a.collected,
    openDisputes: a.openDisputes,
    pendingVariations: a.pendingVariations,
    blockers: [
      ...(a.pendingVariations > 0n ? ['Variations awaiting a decision'] : []),
      ...(a.openDisputes > 0n ? ['Open disputed amounts'] : []),
      ...(a.advancePaid > a.advanceRecovered ? ['Advance not fully recovered'] : []),
    ],
  };
}
