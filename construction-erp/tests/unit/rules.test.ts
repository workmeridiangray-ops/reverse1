import { describe, expect, it } from 'vitest';
import { formatINR, parseMoney, parseQty, lineAmount, divRound, RuleError, formatQty } from '@/lib/rules/money';
import { computeBill, invoiceStatus, variationCost, finalAccount } from '@/lib/rules/billing';
import { checkMeasurement, checkSegregation, computeSubBill } from '@/lib/rules/subcontract';
import { checkIssue, checkReceipt, onHand, budgetPosition } from '@/lib/rules/stock';
import { checkEntitlement, downgradeImpact, prorate, priceInvoice, subscriptionState } from '@/lib/rules/plan';
import { findCycle, dependencyViolations, progressBp, holdPointBlocks, varianceDays } from '@/lib/rules/schedule';
import { parseBoqCsv, analyseRate, marginBp } from '@/lib/rules/boq';

const R = (n: number) => BigInt(n) * 100n; // rupees -> paise

describe('money', () => {
  it('parses and formats Indian grouping', () => {
    expect(parseMoney('1,25,000.50')).toBe(12500050n);
    expect(formatINR(12500050n)).toBe('₹1,25,000.50');
    expect(formatINR(-9900000000n)).toBe('-₹9,90,00,000.00');
    expect(formatINR(5n)).toBe('₹0.05');
  });
  it('rejects more than 2 decimals instead of rounding', () => {
    expect(() => parseMoney('10.005')).toThrow(RuleError);
    expect(() => parseQty('1.2345')).toThrow(RuleError);
    expect(() => parseMoney('abc')).toThrow(RuleError);
  });
  it('rounds half up, symmetric for negatives', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(lineAmount(parseQty('12.345'), R(333))).toBe(divRound(12345n * 33300n, 1000n));
    expect(formatQty(12345n)).toBe('12.345');
  });
});

describe('running account bill — worked example', () => {
  // BOQ A: 1000 m3 @ ₹5,000. Advance paid ₹5,00,000. Advance recovery 10%, retention 5%.
  const terms = { advanceRecoveryBp: 1000, retentionBp: 500 };
  const base = { boqItemId: 'A', ratePaise: R(5000), boqQtyMilli: parseQty('1000') };
  const bill1 = computeBill([{ ...base, prevCumMilli: 0n, thisMilli: parseQty('400') }], terms,
    { cumGrossPaise: 0n, cumAdvanceRecoveredPaise: 0n, cumRetentionPaise: 0n, advancePaidPaise: R(500000) });
  it('bill 1 deducts recoveries', () => {
    expect(bill1.cumGrossPaise).toBe(R(2000000));
    expect(bill1.cumAdvanceRecoveryPaise).toBe(R(200000));
    expect(bill1.cumRetentionPaise).toBe(R(100000));
    expect(bill1.netPayablePaise).toBe(R(1700000));
  });
  const bill2 = computeBill([{ ...base, prevCumMilli: parseQty('400'), thisMilli: parseQty('300'), certifiedThisMilli: parseQty('250') }], terms,
    { cumGrossPaise: bill1.cumGrossPaise, cumAdvanceRecoveredPaise: bill1.cumAdvanceRecoveryPaise, cumRetentionPaise: bill1.cumRetentionPaise, advancePaidPaise: R(500000) });
  it('bill 2 is partially certified and cumulative', () => {
    expect(bill2.submittedPaise).toBe(R(1500000));
    expect(bill2.thisCertifiedGrossPaise).toBe(R(1250000));
    expect(bill2.cumGrossPaise).toBe(R(3250000));
    expect(bill2.cumAdvanceRecoveryPaise).toBe(R(325000));
    expect(bill2.cumRetentionPaise).toBe(R(162500));
    expect(bill2.netPayablePaise).toBe(R(1062500)); // 27,62,500 - 17,00,000
  });
  it('cannot bill beyond the BOQ quantity', () => {
    expect(() => computeBill([{ ...base, prevCumMilli: parseQty('650'), thisMilli: parseQty('400') }], terms,
      { cumGrossPaise: 0n, cumAdvanceRecoveredPaise: 0n, cumRetentionPaise: 0n, advancePaidPaise: 0n })).toThrow(/exceeds BOQ/);
  });
  it('advance recovery is capped at the advance actually paid', () => {
    const b = computeBill([{ ...base, prevCumMilli: 0n, thisMilli: parseQty('1000') }], { advanceRecoveryBp: 5000, retentionBp: 0 },
      { cumGrossPaise: 0n, cumAdvanceRecoveredPaise: 0n, cumRetentionPaise: 0n, advancePaidPaise: R(100000) });
    expect(b.cumAdvanceRecoveryPaise).toBe(R(100000));
  });
  it('certified quantity cannot exceed claimed', () => {
    expect(() => computeBill([{ ...base, prevCumMilli: 0n, thisMilli: parseQty('10'), certifiedThisMilli: parseQty('11') }], terms,
      { cumGrossPaise: 0n, cumAdvanceRecoveredPaise: 0n, cumRetentionPaise: 0n, advancePaidPaise: 0n })).toThrow(RuleError);
  });
});

describe('invoices, disputes, variations, final account', () => {
  it('derives status from amounts', () => {
    expect(invoiceStatus(R(100), 0n, 0n)).toBe('issued');
    expect(invoiceStatus(R(100), R(40), 0n)).toBe('part_paid');
    expect(invoiceStatus(R(100), R(40), R(20))).toBe('disputed');
    expect(invoiceStatus(R(100), R(100), 0n)).toBe('paid');
    expect(invoiceStatus(R(100), R(70), 0n, R(30))).toBe('settled');
    expect(() => invoiceStatus(R(100), R(101), 0n)).toThrow();
  });
  it('variation on an existing item must keep the contract rate', () => {
    expect(variationCost([{ qtyMilli: parseQty('10'), ratePaise: R(500), baseRatePaise: R(500) }])).toBe(R(5000));
    expect(() => variationCost([{ qtyMilli: 1000n, ratePaise: R(600), baseRatePaise: R(500) }])).toThrow(/original contract rate/);
    expect(variationCost([{ qtyMilli: parseQty('2'), ratePaise: R(900) }])).toBe(R(1800)); // new item, new rate
  });
  it('final account lists blockers', () => {
    const f = finalAccount({ contractValue: R(1000), approvedVariations: R(100), certifiedGross: R(1000), advancePaid: R(100), advanceRecovered: R(60),
      retentionHeld: R(50), invoiced: R(900), collected: R(800), openDisputes: R(10), pendingVariations: R(5) });
    expect(f.revisedValue).toBe(R(1100)); expect(f.unbilled).toBe(R(100)); expect(f.receivable).toBe(R(100));
    expect(f.blockers).toHaveLength(3);
  });
});

describe('subcontract', () => {
  it('measurement respects limit + tolerance and cumulative quantity', () => {
    expect(checkMeasurement({ limitMilli: 100000n, tolBp: 500, prevCumMilli: 90000n, thisMilli: 10000n }).withinLimit).toBe(true);
    expect(checkMeasurement({ limitMilli: 100000n, tolBp: 500, prevCumMilli: 90000n, thisMilli: 14000n }).withinLimit).toBe(false);
    expect(() => checkMeasurement({ limitMilli: 100000n, tolBp: 500, prevCumMilli: 90000n, thisMilli: 16000n })).toThrow(/exceeds permitted/);
  });
  it('splits preparer / verifier / approver', () => {
    expect(() => checkSegregation('a', null, 'a', 'verify')).toThrow();
    expect(() => checkSegregation('a', 'b', 'b', 'approve')).toThrow();
    expect(() => checkSegregation('a', 'b', 'c', 'approve')).not.toThrow();
  });
  it('sub bill: retention, capped advance, recoveries — visible', () => {
    const r = computeSubBill({ lines: [{ qtyMilli: parseQty('100'), ratePaise: R(800) }], retentionBp: 500, advanceOutstandingPaise: R(3000), advanceRecoveryBp: 1000,
      materialRecoveryPaise: R(2000), otherDeductionsPaise: R(500) });
    expect(r.gross).toBe(R(80000)); expect(r.retention).toBe(R(4000)); expect(r.advance).toBe(R(3000)); expect(r.net).toBe(R(80000 - 4000 - 3000 - 2000 - 500));
    expect(() => computeSubBill({ lines: [{ qtyMilli: 1000n, ratePaise: R(1) }], retentionBp: 0, advanceOutstandingPaise: 0n, advanceRecoveryBp: 0, materialRecoveryPaise: R(5), otherDeductionsPaise: 0n })).toThrow(/exceed/);
  });
});

describe('stock', () => {
  const ms = [
    { itemCode: 'CEM', siteId: 's1', bucket: 'store' as const, qtyMilli: 100000n },
    { itemCode: 'CEM', siteId: 's1', bucket: 'store' as const, qtyMilli: -30000n },
    { itemCode: 'CEM', siteId: 's1', bucket: 'quarantine' as const, qtyMilli: 5000n },
  ];
  it('computes balances per bucket and blocks over-issue', () => {
    expect(onHand(ms, 's1', 'CEM')).toBe(70000n); expect(onHand(ms, 's1', 'CEM', 'quarantine')).toBe(5000n);
    expect(() => checkIssue(70000n, 70001n)).toThrow(/available/);
  });
  it('receipt split and over-receipt', () => {
    expect(() => checkReceipt({ orderedMilli: 1000n, receivedSoFarMilli: 0n, receivedMilli: 500n, acceptedMilli: 300n, rejectedMilli: 100n })).toThrow(/equal/);
    expect(() => checkReceipt({ orderedMilli: 1000n, receivedSoFarMilli: 800n, receivedMilli: 300n, acceptedMilli: 300n, rejectedMilli: 0n })).toThrow(/exceeds/);
    expect(budgetPosition(R(100), R(120), 0n).overCommitted).toBe(true);
  });
});

describe('plans & subscriptions', () => {
  const limits = { users: 5, projects: 2, storage_mb: 2048, branches: 1 };
  it('entitlements and downgrade impact', () => {
    expect(() => checkEntitlement(limits, { users: 5, projects: 1, storage_mb: 0, branches: 1 }, 'users')).toThrow(/upgrade/);
    expect(downgradeImpact(limits, { users: 9, projects: 2, storage_mb: 100, branches: 3 }).map(x => [x.resource, x.excess])).toEqual([['users', 4], ['branches', 2]]);
  });
  it('prorates by days and prices GST', () => {
    const p = prorate({ oldPaise: R(3000), newPaise: R(6000), periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31'), now: new Date('2026-01-16') });
    expect(p.totalDays).toBe(30); expect(p.daysLeft).toBe(15); expect(p.creditPaise).toBe(R(1500)); expect(p.chargePaise).toBe(R(3000)); expect(p.dueNowPaise).toBe(R(1500));
    const inv = priceInvoice(R(4999), 10, 18);
    // ₹4,999 − 10% = ₹4,499.10 taxable; GST 18% = ₹809.838 → ₹809.84 (half-up)
    expect(inv.discount).toBe(49990n); expect(inv.tax).toBe(80984n); expect(inv.total).toBe(530894n);
    expect(priceInvoice(R(1000), 0, 18).total).toBe(R(1180));
  });
  it('trial, active, grace, expired', () => {
    const now = new Date('2026-02-10');
    expect(subscriptionState({ status: 'trialing', trialEndsAt: new Date('2026-02-20') }, now)).toBe('trialing');
    expect(subscriptionState({ status: 'trialing', trialEndsAt: new Date('2026-02-01') }, now)).toBe('expired');
    expect(subscriptionState({ status: 'active', periodEnd: new Date('2026-03-01') }, now)).toBe('active');
    expect(subscriptionState({ status: 'past_due', periodEnd: new Date('2026-02-05'), graceUntil: new Date('2026-02-12') }, now)).toBe('grace');
    expect(subscriptionState({ status: 'past_due', periodEnd: new Date('2026-02-05'), graceUntil: new Date('2026-02-08') }, now)).toBe('expired');
    expect(subscriptionState({ status: 'cancelled', periodEnd: new Date('2026-02-20') }, now)).toBe('active');
  });
});

describe('schedule', () => {
  it('detects cycles and FS violations; baseline variance', () => {
    expect(findCycle([{ pred: 'a', succ: 'b', lag: 0 }, { pred: 'b', succ: 'c', lag: 0 }, { pred: 'c', succ: 'a', lag: 0 }]).sort()).toEqual(['a', 'b', 'c']);
    expect(findCycle([{ pred: 'a', succ: 'b', lag: 0 }])).toEqual([]);
    const v = dependencyViolations([{ id: 'a', start: '2026-01-01', finish: '2026-01-10' }, { id: 'b', start: '2026-01-10', finish: '2026-01-20' }], [{ pred: 'a', succ: 'b', lag: 0 }]);
    expect(v).toEqual([{ pred: 'a', succ: 'b', earliestStart: '2026-01-11' }]);
    expect(varianceDays('2026-01-10', '2026-01-15')).toBe(5);
  });
  it('progress uses defined rules; hold points block', () => {
    expect(progressBp('quantity', 25000n, 100000n)).toBe(2500);
    expect(progressBp('quantity', 150000n, 100000n)).toBe(10000);
    expect(progressBp('milestone', 0n, 0n, false)).toBe(0);
    expect(holdPointBlocks(true, [{ hold_point: true, status: 'requested' }])).toBe(true);
    expect(holdPointBlocks(true, [{ hold_point: true, status: 'passed' }])).toBe(false);
    expect(holdPointBlocks(false, [])).toBe(false);
  });
});

describe('BOQ import & estimating', () => {
  it('validates every row and reports row numbers', () => {
    const csv = 'code,description,unit,qty,rate\nA1,Excavation,m3,100,250.50\nA1,Dup,m3,1,1\nA2,Bad unit,parsec,1,1\nA3,"Concrete, M25",m3,10.1234,5000\nA4,Neg,m3,5,-1\nA5,Short,m3,5';
    const r = parseBoqCsv(csv);
    expect(r.rows.map(x => x.code)).toEqual(['A1']);
    expect(r.errors.map(e => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(parseBoqCsv('x,y\n1,2').errors[0].message).toMatch(/Header/);
  });
  it('rate analysis and margin', () => {
    expect(analyseRate(R(600), R(250), R(150), 1000)).toBe(R(1100));
    expect(marginBp(R(1100), R(1000))).toBe(909);
  });
});
