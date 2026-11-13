import { amountFor, percentOf } from "./qty";

/**
 * Subcontract bill (pure). Billable quantity per work-order line is the cumulative APPROVED measurement
 * minus what earlier bills already paid, so the same measured work can never be billed twice.
 */
export class SubcontractError extends Error { override name = "SubcontractError"; }
export interface SubLine { id: string; code?: string; rateMinor: number; orderedMilli: number; approvedMilli: number; billedMilli: number; }

export function subBill(lines: SubLine[], retentionBp: number, materialRecoveryMinor: number, advanceRecoveryMinor = 0) {
  const out = lines.map((l) => {
    if (l.approvedMilli > l.orderedMilli) throw new SubcontractError(`${l.code ?? l.id}: approved quantity exceeds the work-order quantity.`);
    const qty = l.approvedMilli - l.billedMilli;
    if (qty < 0) throw new SubcontractError(`${l.code ?? l.id}: billed quantity exceeds approved quantity.`);
    return { ...l, qtyMilli: qty, amountMinor: amountFor(l.approvedMilli, l.rateMinor) - amountFor(l.billedMilli, l.rateMinor) };
  });
  const gross = out.reduce((a, l) => a + l.amountMinor, 0);
  if (gross <= 0) throw new SubcontractError("There is no approved, unbilled work.");
  const retention = percentOf(gross, retentionBp);
  const net = gross - retention - materialRecoveryMinor - advanceRecoveryMinor;
  if (net < 0) throw new SubcontractError("Deductions exceed the gross amount.");
  return { lines: out, grossMinor: gross, retentionMinor: retention, materialRecoveryMinor, advanceRecoveryMinor, netMinor: net };
}

/** Sum of work-order quantity across packages for a BOQ item may not exceed what the contract allows. */
export const woHeadroom = (boqEffectiveMilli: number, alreadyOrderedMilli: number) => boqEffectiveMilli - alreadyOrderedMilli;
