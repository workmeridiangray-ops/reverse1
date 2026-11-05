import { addDays, addMonths, daysBetween } from './format';

export interface Line { desc: string; qty: number; rate: number; discountPct?: number; taxPct: number; itemId?: string; unit?: string }
export interface LineCalc { gross: number; discount: number; taxable: number; tax: number; total: number }

/** One line: all amounts in paise, rounded half-up per line so documents always sum from their lines. */
export function calcLine(l: Line): LineCalc {
  const gross = Math.round(l.qty * l.rate);
  const discount = Math.round((gross * (l.discountPct ?? 0)) / 100);
  const taxable = gross - discount;
  const tax = Math.round((taxable * l.taxPct) / 100);
  return { gross, discount, taxable, tax, total: taxable + tax };
}
export interface DocTotals { subtotal: number; discount: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number; roundOff: number; total: number; byRate: { rate: number; taxable: number; tax: number }[] }
/** Document totals. Intra-state supply splits tax into CGST+SGST, inter-state is IGST. Total is rounded to whole rupees. */
export function calcDoc(lines: Line[], opts: { intraState: boolean; docDiscountPct?: number } = { intraState: true }): DocTotals {
  const docPct = opts.docDiscountPct ?? 0;
  const byRateMap = new Map<number, { taxable: number; tax: number }>();
  let subtotal = 0, discount = 0, taxable = 0, tax = 0;
  for (const l of lines) {
    const c = calcLine(l);
    const extra = Math.round((c.taxable * docPct) / 100);
    const tx = c.taxable - extra;
    const t = Math.round((tx * l.taxPct) / 100);
    subtotal += c.gross; discount += c.discount + extra; taxable += tx; tax += t;
    const cur = byRateMap.get(l.taxPct) ?? { taxable: 0, tax: 0 };
    byRateMap.set(l.taxPct, { taxable: cur.taxable + tx, tax: cur.tax + t });
  }
  const cgst = opts.intraState ? Math.floor(tax / 2) : 0;
  const sgst = opts.intraState ? tax - cgst : 0;
  const igst = opts.intraState ? 0 : tax;
  const raw = taxable + tax;
  const total = Math.round(raw / 100) * 100;
  return { subtotal, discount, taxable, cgst, sgst, igst, tax, roundOff: total - raw, total, byRate: [...byRateMap].map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate) };
}

export type InvoiceStatus = 'draft' | 'pending_approval' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'disputed' | 'void';
export interface InvLike { status: string; total: number; dueDate: string; voided?: boolean; id: string }
export interface AllocLike { invoiceId: string; amount: number; reversed?: boolean }
export interface CreditLike { invoiceId: string; amount: number; kind: 'credit' | 'debit'; status: string }
export interface DisputeLike { invoiceId: string; status: string; amount: number }

export const allocatedTo = (invId: string, allocs: AllocLike[]) => allocs.filter((a) => a.invoiceId === invId && !a.reversed).reduce((s, a) => s + a.amount, 0);
export const creditedTo = (invId: string, credits: CreditLike[]) => credits.filter((c) => c.invoiceId === invId && c.status === 'approved').reduce((s, c) => s + (c.kind === 'credit' ? c.amount : -c.amount), 0);
/** Outstanding = total - receipts allocated - credits + debit adjustments. Never negative for an open document. */
export function outstanding(inv: InvLike, allocs: AllocLike[], credits: CreditLike[]) {
  if (inv.status === 'draft' || inv.status === 'pending_approval' || inv.status === 'void') return 0;
  return Math.max(0, inv.total - allocatedTo(inv.id, allocs) - creditedTo(inv.id, credits));
}
export function disputedAmount(invId: string, disputes: DisputeLike[]) {
  return disputes.filter((d) => d.invoiceId === invId && ['open', 'under_review'].includes(d.status)).reduce((s, d) => s + d.amount, 0);
}
/** Derived display status. Drafts and void are stored; the rest follows balances and dates. */
export function derivedStatus(inv: InvLike, allocs: AllocLike[], credits: CreditLike[], disputes: DisputeLike[], now: string): InvoiceStatus {
  if (inv.status === 'draft' || inv.status === 'pending_approval' || inv.status === 'void') return inv.status as InvoiceStatus;
  const out = outstanding(inv, allocs, credits);
  if (out === 0) return 'paid';
  if (disputedAmount(inv.id, disputes) > 0) return 'disputed';
  if (inv.dueDate < now) return 'overdue';
  return allocatedTo(inv.id, allocs) > 0 ? 'partially_paid' : 'issued';
}

export const BUCKETS = ['Not due', '1–30', '31–60', '61–90', '90+'] as const;
export function ageBucket(dueDate: string, now: string): (typeof BUCKETS)[number] {
  const d = daysBetween(dueDate, now);
  if (d <= 0) return 'Not due';
  if (d <= 30) return '1–30';
  if (d <= 60) return '31–60';
  if (d <= 90) return '61–90';
  return '90+';
}

export interface AllocCheck { ok: boolean; error?: string }
/** A receipt may be split across invoices but never over-applied; an invoice never over-collected. */
export function checkAllocation(receiptUnapplied: number, requests: { invoiceOutstanding: number; amount: number }[]): AllocCheck {
  const sum = requests.reduce((s, r) => s + r.amount, 0);
  if (requests.some((r) => !Number.isInteger(r.amount) || r.amount <= 0)) return { ok: false, error: 'Each allocation must be a positive amount.' };
  if (sum > receiptUnapplied) return { ok: false, error: 'Allocations exceed the unapplied receipt amount.' };
  if (requests.some((r) => r.amount > r.invoiceOutstanding)) return { ok: false, error: 'An allocation exceeds that invoice’s outstanding balance.' };
  return { ok: true };
}
export function checkAdjustment(kind: 'credit' | 'debit', amount: number, invoiceOutstanding: number, invoiceTotal: number): AllocCheck {
  if (amount <= 0) return { ok: false, error: 'Amount must be greater than zero.' };
  if (kind === 'credit' && amount > invoiceTotal) return { ok: false, error: 'Credit cannot exceed the invoice total.' };
  if (kind === 'credit' && amount > invoiceOutstanding) return { ok: false, error: 'Credit exceeds the outstanding balance; refund the paid part instead.' };
  return { ok: true };
}
export function periodLocked(d: string, periods: { start: string; end: string; locked: boolean }[]) {
  return periods.some((p) => p.locked && d >= p.start && d <= p.end);
}
export function validateInvoice(i: { customerId?: string; lines: Line[]; issueDate?: string; dueDate?: string }): string[] {
  const e: string[] = [];
  if (!i.customerId) e.push('Choose a customer.');
  if (!i.lines.length) e.push('Add at least one line.');
  i.lines.forEach((l, n) => {
    if (!l.desc?.trim()) e.push(`Line ${n + 1}: description is required.`);
    if (!(l.qty > 0)) e.push(`Line ${n + 1}: quantity must be greater than zero.`);
    if (!(l.rate >= 0)) e.push(`Line ${n + 1}: rate cannot be negative.`);
  });
  if (!i.issueDate) e.push('Issue date is required.');
  if (!i.dueDate) e.push('Due date is required.');
  else if (i.issueDate && i.dueDate < i.issueDate) e.push('Due date cannot be before the issue date.');
  return e;
}
export const docNumber = (prefix: string, fy: string, seq: number, pad = 4) => `${prefix}/${fy}/${String(seq).padStart(pad, '0')}`;
export function fiscalYear(d: string) { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}-${String(s + 1).slice(2)}`; }
export type Freq = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export function nextRun(from: string, f: Freq) { return f === 'weekly' ? addDays(from, 7) : f === 'monthly' ? addMonths(from, 1) : f === 'quarterly' ? addMonths(from, 3) : addMonths(from, 12); }
/** Prorate a charge by remaining days in a period. */
export function prorate(amount: number, periodDays: number, daysUsed: number) { return Math.round((amount * Math.max(0, periodDays - daysUsed)) / periodDays); }
export interface BankTxLike { id: string; ref: string; amount: number; date: string; direction: 'in' | 'out' }
export interface MatchCandidate { id: string; ref: string; amount: number; date: string }
/** Deterministic matching: exact reference first, then exact amount within 5 days when unique. */
export function suggestMatch(tx: BankTxLike, candidates: MatchCandidate[]): { id: string; confidence: 'reference' | 'amount-date' } | null {
  const byRef = candidates.find((c) => c.ref && tx.ref && c.ref.toLowerCase() === tx.ref.toLowerCase() && c.amount === tx.amount);
  if (byRef) return { id: byRef.id, confidence: 'reference' };
  const near = candidates.filter((c) => c.amount === tx.amount && Math.abs(daysBetween(c.date, tx.date)) <= 5);
  return near.length === 1 ? { id: near[0].id, confidence: 'amount-date' } : null;
}
export const isDuplicateBill = (supplierId: string, ref: string, bills: { supplierId: string; ref: string }[]) =>
  bills.some((b) => b.supplierId === supplierId && b.ref.trim().toLowerCase() === ref.trim().toLowerCase());
