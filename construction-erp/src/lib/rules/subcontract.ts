import { RuleError, bpOf, lineAmount, min, sum } from './money';

/** Cumulative measured quantity may not exceed the work-order limit plus its tolerance. */
export function checkMeasurement(p: { limitMilli: bigint; tolBp: number; prevCumMilli: bigint; thisMilli: bigint }) {
  const allowed = p.limitMilli + bpOf(p.limitMilli, p.tolBp);
  const cum = p.prevCumMilli + p.thisMilli;
  if (cum > allowed) throw new RuleError(`cumulative measured quantity ${cum} exceeds permitted ${allowed}`, 'over_limit');
  return { cumMilli: cum, allowedMilli: allowed, withinLimit: cum <= p.limitMilli };
}

/** Preparation, verification and approval must be three different people. */
export function checkSegregation(preparedBy: string | null, verifiedBy: string | null, approver: string, step: 'verify' | 'approve') {
  if (step === 'verify' && approver === preparedBy) throw new RuleError('the preparer cannot verify their own measurement', 'segregation');
  if (step === 'approve' && (approver === preparedBy || approver === verifiedBy)) throw new RuleError('approval needs someone other than the preparer and verifier', 'segregation');
}

export interface SubBillInput {
  lines: { qtyMilli: bigint; ratePaise: bigint }[];
  retentionBp: number; advanceOutstandingPaise: bigint; advanceRecoveryBp: number;
  materialRecoveryPaise: bigint; otherDeductionsPaise: bigint;
}
export function computeSubBill(i: SubBillInput) {
  const gross = sum(i.lines.map(l => lineAmount(l.qtyMilli, l.ratePaise)));
  const retention = bpOf(gross, i.retentionBp);
  const advance = min(bpOf(gross, i.advanceRecoveryBp), i.advanceOutstandingPaise);
  const net = gross - retention - advance - i.materialRecoveryPaise - i.otherDeductionsPaise;
  if (net < 0n) throw new RuleError('deductions exceed the gross value of the bill', 'negative_net');
  return { gross, retention, advance, material: i.materialRecoveryPaise, other: i.otherDeductionsPaise, net };
}
