import { describe, it, expect } from 'vitest';
import { calcLine, calcDoc, outstanding, derivedStatus, ageBucket, checkAllocation, checkAdjustment, periodLocked, validateInvoice, suggestMatch, fiscalYear, nextRun, prorate, isDuplicateBill, docNumber } from './rules';

describe('totals', () => {
  it('calculates a line with discount and tax', () => {
    expect(calcLine({ desc: 'x', qty: 2, rate: 100000, discountPct: 10, taxPct: 18 })).toEqual({ gross: 200000, discount: 20000, taxable: 180000, tax: 32400, total: 212400 });
  });
  it('splits intra-state tax into CGST+SGST and rounds to rupee', () => {
    const t = calcDoc([{ desc: 'a', qty: 1, rate: 100050, taxPct: 18 }], { intraState: true });
    expect(t.cgst + t.sgst).toBe(t.tax);
    expect(t.igst).toBe(0);
    expect(t.total % 100).toBe(0);
    expect(t.taxable + t.tax + t.roundOff).toBe(t.total);
  });
  it('uses IGST for inter-state supply', () => {
    const t = calcDoc([{ desc: 'a', qty: 1, rate: 100000, taxPct: 12 }], { intraState: false });
    expect(t.igst).toBe(12000); expect(t.cgst).toBe(0);
  });
  it('applies a document discount before tax', () => {
    const t = calcDoc([{ desc: 'a', qty: 1, rate: 100000, taxPct: 18 }], { intraState: true, docDiscountPct: 10 });
    expect(t.taxable).toBe(90000); expect(t.tax).toBe(16200);
  });
});
describe('balances', () => {
  const inv = { id: 'i1', status: 'issued', total: 100000, dueDate: '2026-01-10' };
  it('outstanding subtracts receipts and approved credits, ignores reversed', () => {
    expect(outstanding(inv, [{ invoiceId: 'i1', amount: 30000 }, { invoiceId: 'i1', amount: 99999, reversed: true }], [{ invoiceId: 'i1', amount: 10000, kind: 'credit', status: 'approved' }, { invoiceId: 'i1', amount: 5000, kind: 'credit', status: 'pending' }])).toBe(60000);
  });
  it('debit adjustments increase the balance', () => {
    expect(outstanding(inv, [], [{ invoiceId: 'i1', amount: 5000, kind: 'debit', status: 'approved' }])).toBe(105000);
  });
  it('derives status', () => {
    expect(derivedStatus(inv, [], [], [], '2026-02-01')).toBe('overdue');
    expect(derivedStatus(inv, [], [], [], '2026-01-01')).toBe('issued');
    expect(derivedStatus(inv, [{ invoiceId: 'i1', amount: 1000 }], [], [], '2026-01-01')).toBe('partially_paid');
    expect(derivedStatus(inv, [{ invoiceId: 'i1', amount: 100000 }], [], [], '2026-02-01')).toBe('paid');
    expect(derivedStatus(inv, [], [], [{ invoiceId: 'i1', status: 'open', amount: 5000 }], '2026-02-01')).toBe('disputed');
    expect(derivedStatus({ ...inv, status: 'draft' }, [], [], [], '2026-02-01')).toBe('draft');
  });
});
describe('ageing', () => {
  it('buckets by days past due', () => {
    expect(ageBucket('2026-02-10', '2026-02-01')).toBe('Not due');
    expect(ageBucket('2026-01-20', '2026-02-01')).toBe('1–30');
    expect(ageBucket('2025-12-20', '2026-02-01')).toBe('31–60');
    expect(ageBucket('2025-11-20', '2026-02-01')).toBe('61–90');
    expect(ageBucket('2025-06-01', '2026-02-01')).toBe('90+');
  });
});
describe('allocation guards', () => {
  it('rejects over-application and over-collection', () => {
    expect(checkAllocation(1000, [{ invoiceOutstanding: 5000, amount: 1500 }]).ok).toBe(false);
    expect(checkAllocation(5000, [{ invoiceOutstanding: 1000, amount: 1500 }]).ok).toBe(false);
    expect(checkAllocation(5000, [{ invoiceOutstanding: 3000, amount: 2000 }, { invoiceOutstanding: 3000, amount: 3000 }]).ok).toBe(true);
    expect(checkAllocation(5000, [{ invoiceOutstanding: 3000, amount: 0 }]).ok).toBe(false);
  });
  it('credit notes cannot exceed outstanding', () => {
    expect(checkAdjustment('credit', 6000, 5000, 9000).ok).toBe(false);
    expect(checkAdjustment('credit', 4000, 5000, 9000).ok).toBe(true);
    expect(checkAdjustment('debit', 4000, 0, 9000).ok).toBe(true);
  });
});
describe('misc rules', () => {
  it('period locks', () => { expect(periodLocked('2026-04-10', [{ start: '2026-04-01', end: '2026-04-30', locked: true }])).toBe(true); expect(periodLocked('2026-05-10', [{ start: '2026-04-01', end: '2026-04-30', locked: true }])).toBe(false); });
  it('validates invoices before issue', () => {
    expect(validateInvoice({ lines: [] }).length).toBeGreaterThan(2);
    expect(validateInvoice({ customerId: 'c', issueDate: '2026-01-02', dueDate: '2026-01-01', lines: [{ desc: 'a', qty: 1, rate: 1, taxPct: 0 }] })).toEqual(['Due date cannot be before the issue date.']);
    expect(validateInvoice({ customerId: 'c', issueDate: '2026-01-02', dueDate: '2026-02-01', lines: [{ desc: 'a', qty: 1, rate: 1, taxPct: 0 }] })).toEqual([]);
  });
  it('matches bank rows deterministically', () => {
    const cands = [{ id: 'r1', ref: 'UTR123', amount: 5000, date: '2026-01-03' }, { id: 'r2', ref: '', amount: 7000, date: '2026-01-04' }];
    expect(suggestMatch({ id: 't', ref: 'utr123', amount: 5000, date: '2026-01-04', direction: 'in' }, cands)).toEqual({ id: 'r1', confidence: 'reference' });
    expect(suggestMatch({ id: 't', ref: 'zzz', amount: 7000, date: '2026-01-06', direction: 'in' }, cands)).toEqual({ id: 'r2', confidence: 'amount-date' });
    expect(suggestMatch({ id: 't', ref: 'zzz', amount: 7000, date: '2026-03-06', direction: 'in' }, cands)).toBeNull();
  });
  it('fiscal year, numbering, recurrence, proration, duplicates', () => {
    expect(fiscalYear('2026-03-31')).toBe('25-26'); expect(fiscalYear('2026-04-01')).toBe('26-27');
    expect(docNumber('INV', '26-27', 7)).toBe('INV/26-27/0007');
    expect(nextRun('2026-01-31', 'monthly')).toBe('2026-03-03');
    expect(nextRun('2026-01-01', 'quarterly')).toBe('2026-04-01');
    expect(prorate(30000, 30, 10)).toBe(20000);
    expect(isDuplicateBill('s1', ' B-1 ', [{ supplierId: 's1', ref: 'b-1' }])).toBe(true);
    expect(isDuplicateBill('s2', 'b-1', [{ supplierId: 's1', ref: 'b-1' }])).toBe(false);
  });
});
