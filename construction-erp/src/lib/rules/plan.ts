import { RuleError, bpOf, divRound } from './money';

export interface Limits { users: number; projects: number; storage_mb: number; branches: number }
export interface Usage { users: number; projects: number; storage_mb: number; branches: number }

export function checkEntitlement(limits: Limits, usage: Usage, resource: keyof Limits, adding = 1) {
  const would = usage[resource] + adding;
  if (would > limits[resource]) throw new RuleError(`Your plan allows ${limits[resource]} ${resource.replace('_', ' ')}; upgrade to add more`, 'plan_limit');
}
/** What must be resolved before a downgrade can take effect. */
export function downgradeImpact(newLimits: Limits, usage: Usage) {
  return (Object.keys(newLimits) as (keyof Limits)[])
    .filter(k => usage[k] > newLimits[k])
    .map(k => ({ resource: k, used: usage[k], allowed: newLimits[k], excess: usage[k] - newLimits[k] }));
}

export type SubState = 'trialing' | 'active' | 'grace' | 'expired' | 'cancelled';
export function subscriptionState(s: { status: string; trialEndsAt?: Date | null; periodEnd?: Date | null; graceUntil?: Date | null }, now: Date): SubState {
  if (s.status === 'cancelled') return s.periodEnd && now < s.periodEnd ? 'active' : 'cancelled';
  if (s.status === 'trialing') return s.trialEndsAt && now < s.trialEndsAt ? 'trialing' : 'expired';
  if (s.periodEnd && now <= s.periodEnd && s.status !== 'past_due') return 'active';
  if (s.graceUntil && now <= s.graceUntil) return 'grace';
  return s.status === 'past_due' || (s.periodEnd && now > s.periodEnd) ? 'expired' : 'active';
}

const DAY = 86_400_000;
/** Day-based proration when changing plan mid-period: credit unused old, charge remaining new. */
export function prorate(p: { oldPaise: bigint; newPaise: bigint; periodStart: Date; periodEnd: Date; now: Date }) {
  const total = Math.max(1, Math.round((p.periodEnd.getTime() - p.periodStart.getTime()) / DAY));
  const left = Math.min(total, Math.max(0, Math.ceil((p.periodEnd.getTime() - p.now.getTime()) / DAY)));
  const credit = divRound(p.oldPaise * BigInt(left), BigInt(total));
  const charge = divRound(p.newPaise * BigInt(left), BigInt(total));
  return { totalDays: total, daysLeft: left, creditPaise: credit, chargePaise: charge, dueNowPaise: charge > credit ? charge - credit : 0n, carryCreditPaise: credit > charge ? credit - charge : 0n };
}
export function priceInvoice(subtotal: bigint, couponPercent: number, gstPercent: number) {
  if (couponPercent < 0 || couponPercent > 100) throw new RuleError('invalid coupon');
  const discount = bpOf(subtotal, couponPercent * 100);
  const taxable = subtotal - discount;
  const tax = bpOf(taxable, gstPercent * 100);
  return { subtotal, discount, tax, total: taxable + tax };
}
