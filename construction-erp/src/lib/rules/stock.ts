import { RuleError } from './money';

export interface Movement { itemCode: string; siteId: string; bucket: 'store' | 'quarantine'; qtyMilli: bigint }
export function onHand(ms: Movement[], siteId: string, itemCode: string, bucket: 'store' | 'quarantine' = 'store'): bigint {
  return ms.filter(m => m.siteId === siteId && m.itemCode === itemCode && m.bucket === bucket).reduce((a, m) => a + m.qtyMilli, 0n);
}
export function checkIssue(onHandMilli: bigint, qtyMilli: bigint) {
  if (qtyMilli <= 0n) throw new RuleError('issue quantity must be positive');
  if (qtyMilli > onHandMilli) throw new RuleError(`only ${onHandMilli} available in store`, 'insufficient_stock');
}
/** Goods receipt: accepted + rejected must equal received; cumulative receipts cannot exceed order + tolerance. */
export function checkReceipt(p: { orderedMilli: bigint; receivedSoFarMilli: bigint; receivedMilli: bigint; acceptedMilli: bigint; rejectedMilli: bigint; toleranceBp?: number }) {
  if (p.acceptedMilli + p.rejectedMilli !== p.receivedMilli) throw new RuleError('accepted + rejected must equal received', 'split');
  const allowed = p.orderedMilli + (p.orderedMilli * BigInt(p.toleranceBp ?? 0)) / 10000n;
  if (p.receivedSoFarMilli + p.receivedMilli > allowed) throw new RuleError('receipt exceeds the quantity ordered', 'over_receipt');
}
/** Committed (PO) vs received vs budget for one BOQ item, all in paise. */
export function budgetPosition(budget: bigint, committed: bigint, receivedValue: bigint) {
  return { budget, committed, receivedValue, uncommittedBudget: budget - committed, overCommitted: committed > budget };
}
