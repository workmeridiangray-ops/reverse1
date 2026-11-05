import { useSyncExternalStore } from 'react';
import { seed, DEFAULT_SETTINGS, TENANTS, type DB, type Row } from './data/seed';
import { addDays, today, uid } from './lib/format';
import { calcDoc, docNumber, fiscalYear, outstanding, derivedStatus, validateInvoice, checkAllocation, checkAdjustment, periodLocked, nextRun, isDuplicateBill, suggestMatch, type Line } from './lib/rules';

export interface Session { memberId: string; email: string; name: string; role: string; tenantId: string; platformRole?: string; customerId?: string; mfaPending?: boolean; expired?: boolean }
export interface State { db: DB; settings: Record<string, any>; session: Session | null; flags: { expiredSession?: boolean; branchId?: string }; version: number }
export type Res = { ok: true; id?: string; message?: string } | { ok: false; error: string };
const KEY = 'ledgerline.v1';
const VERSION = 1;

function fresh(): State { const settings: Record<string, any> = {}; TENANTS.forEach((t) => (settings[t.id] = DEFAULT_SETTINGS(t.id))); return { db: seed(), settings, session: null, flags: {}, version: VERSION }; }
function load(): State {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw) as State; if (s.version === VERSION && s.db?.invoices) return s; } } catch { /* storage unavailable or corrupt: start fresh */ }
  return fresh();
}
let state: State = load();
const subs = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode: continue in memory */ } }, 150); }
function commit(next: State) { state = next; subs.forEach((f) => f()); persist(); }
export const getState = () => state;
export function useStore<T>(sel: (s: State) => T): T { return useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => sel(state)) as T; }
export function resetDemo() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } commit(fresh()); }

function mutate(fn: (s: State) => void) { const next: State = { ...state, db: { ...state.db }, settings: { ...state.settings }, flags: { ...state.flags } }; fn(next); commit(next); }
const rows = (s: State, c: string) => (s.db[c] = [...(s.db[c] ?? [])]);
const tid = (s: State) => s.session?.tenantId ?? 't1';
const actor = (s: State) => s.session?.name ?? 'System';

export function logAudit(s: State, action: string, entity = '', sensitive = false) {
  rows(s, 'audit').unshift({ id: uid('au'), tenantId: tid(s), at: new Date().toISOString(), actor: actor(s), action, entity, sensitive });
}
export function insert(c: string, row: Row, audit?: string): Row {
  let out: Row = row;
  mutate((s) => { out = { id: uid(c.slice(0, 3)), tenantId: tid(s), ...row }; rows(s, c).unshift(out); if (audit) logAudit(s, audit, out.id); });
  return out;
}
export function update(c: string, id: string, patch: Row, audit?: string, sensitive = false) {
  mutate((s) => { const a = rows(s, c); const i = a.findIndex((r) => r.id === id); if (i >= 0) a[i] = { ...a[i], ...patch }; if (audit) logAudit(s, audit, id, sensitive); });
}
export function remove(c: string, id: string, audit?: string) { mutate((s) => { s.db[c] = rows(s, c).filter((r) => r.id !== id); if (audit) logAudit(s, audit, id, true); }); }

// ---------- selectors ----------
const PLATFORM = new Set(['biz', 'plans', 'coupons', 'incidents', 'platformStaff', 'platformAudit', 'platformPayments', 'announcements', 'leads', 'tickets', 'storageStats', 'deletionFailures', 'processingFailures', 'platformRefunds', 'jobs']);
export function scoped(s: State, c: string): Row[] {
  const all = s.db[c] ?? [];
  if (PLATFORM.has(c)) return all;
  const t = s.session?.tenantId;
  let r = all.filter((x) => x.tenantId === t);
  // customers only ever see their own organisation's documents
  if (s.session?.customerId) {
    const cid = s.session.customerId;
    if (['invoices', 'receipts', 'credits', 'disputes', 'messages', 'quotes', 'schedules', 'contacts', 'promises'].includes(c)) r = r.filter((x) => x.customerId === cid);
    if (c === 'invoices') r = r.filter((x) => !['draft', 'pending_approval'].includes(x.status));
    if (c === 'allocations') { const mine = new Set(scoped(s, 'invoices').map((x) => x.id)); r = r.filter((a) => mine.has(a.invoiceId)); }
    if (['audit', 'members', 'bankTx', 'bills', 'expenses', 'suppliers', 'supplierPayments', 'integrations', 'apiKeys'].includes(c)) r = [];
  }
  if (c === 'invoices' && s.flags.branchId) r = r.filter((x) => x.branchId === s.flags.branchId);
  return r;
}
export const useRows = (c: string) => { const all = useStore((s) => s.db[c]); const sess = useStore((s) => s.session); return scoped({ ...state, db: { ...state.db, [c]: all }, session: sess }, c); };
export const useSettings = () => useStore((s) => s.settings[s.session?.tenantId ?? 't1']);
export const useSession = () => useStore((s) => s.session);

export interface Bal { out: number; status: string; disputed: number; allocated: number }
export function balances(s: State, tenant = tid(s)) {
  const allocs = (s.db.allocations ?? []).filter((a) => a.tenantId === tenant);
  const credits = (s.db.credits ?? []).filter((a) => a.tenantId === tenant);
  const disputes = (s.db.disputes ?? []).filter((a) => a.tenantId === tenant);
  const now = today(); const map: Record<string, Bal> = {};
  for (const i of (s.db.invoices ?? []).filter((x) => x.tenantId === tenant)) {
    const out = outstanding(i as any, allocs as any, credits as any);
    const dis = disputes.filter((d) => d.invoiceId === i.id && ['open', 'under_review'].includes(d.status)).reduce((a, d) => a + d.amount, 0);
    map[i.id] = { out, status: derivedStatus(i as any, allocs as any, credits as any, disputes as any, now), disputed: Math.min(dis, out), allocated: allocs.filter((a) => a.invoiceId === i.id && !a.reversed).reduce((x, a) => x + a.amount, 0) };
  }
  return map;
}
export const useBalances = () => { const db = useStore((s) => s.db); const sess = useStore((s) => s.session); return balances({ ...state, db, session: sess }); };
export function receiptUnapplied(r: Row, allocs: Row[]) { if (r.status === 'reversed' || r.status === 'refunded') return 0; return r.amount - allocs.filter((a) => a.receiptId === r.id && !a.reversed).reduce((s, a) => s + a.amount, 0) - (r.refunded ?? 0); }

// ---------- auth ----------
export function login(email: string, password: string): Res {
  const e = email.trim().toLowerCase();
  if (!e || !password) return { ok: false, error: 'Enter your email and password.' };
  const staff = state.db.platformStaff.find((p) => p.email.toLowerCase() === e);
  if (staff) { if (password !== 'demo') return { ok: false, error: 'Email or password is incorrect.' }; setSession({ memberId: staff.id, email: staff.email, name: staff.name, role: 'platform', tenantId: 't1', platformRole: staff.role, mfaPending: true }); return { ok: true }; }
  const m = state.db.members.filter((x) => x.email.toLowerCase() === e);
  if (m.length) {
    if (m[0].password !== password) return { ok: false, error: 'Email or password is incorrect.' };
    const active = m.filter((x) => x.status === 'active');
    if (!active.length) return { ok: false, error: m[0].status === 'suspended' ? 'This account is suspended. Contact your business owner.' : 'Accept your invitation first.' };
    const a = active[0]; setSession({ memberId: a.id, email: a.email, name: a.name, role: a.role, tenantId: a.tenantId, mfaPending: !!a.mfa }); return { ok: true };
  }
  const ct = state.db.contacts.find((c) => c.email.toLowerCase() === e && c.portal);
  if (ct) {
    const link = state.db.portalLinks.find((l) => l.customerId === ct.customerId);
    if (!link?.active) return { ok: false, error: 'Portal access for your organisation has been revoked. Contact the supplier.' };
    if (password !== 'demo') return { ok: false, error: 'Email or password is incorrect.' };
    const cu = state.db.customers.find((c) => c.id === ct.customerId)!; setSession({ memberId: ct.id, email: ct.email, name: ct.name, role: 'customer', tenantId: cu.tenantId, customerId: cu.id }); return { ok: true };
  }
  return { ok: false, error: 'Email or password is incorrect.' };
}
function setSession(sess: Session | null) { mutate((s) => { s.session = sess; s.flags.expiredSession = false; }); }
export function verify2fa(code: string): Res { if (code.trim() !== '123456') return { ok: false, error: 'That code is not valid. Use 123456 in this demo.' }; mutate((s) => { if (s.session) s.session = { ...s.session, mfaPending: false }; }); return { ok: true }; }
export function logout() { setSession(null); }
export function expireSession() { mutate((s) => { s.session = null; s.flags.expiredSession = true; }); }
export function workspacesFor(email: string): (Row & { tenant: (typeof TENANTS)[number] })[] { return state.db.members.filter((m) => m.email.toLowerCase() === email.toLowerCase() && m.status === 'active').map((m) => ({ ...m, tenant: TENANTS.find((t) => t.id === m.tenantId)! })); }
export function switchWorkspace(memberId: string): Res {
  const m = state.db.members.find((x) => x.id === memberId && x.email === state.session?.email && x.status === 'active');
  if (!m) return { ok: false, error: 'You do not have access to that workspace.' };
  mutate((s) => { s.session = { ...s.session!, memberId: m.id, role: m.role, tenantId: m.tenantId }; logAudit(s, 'Switched workspace', m.tenantId); }); return { ok: true };
}
export function signup(v: Row): Res {
  if (!v.name?.trim() || !v.company?.trim()) return { ok: false, error: 'Name and company are required.' };
  if (!/^\S+@\S+\.\S+$/.test(v.email ?? '')) return { ok: false, error: 'Enter a valid work email.' };
  if ((v.password ?? '').length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  if (state.db.members.some((m) => m.email.toLowerCase() === v.email.toLowerCase())) return { ok: false, error: 'An account with this email already exists. Sign in instead.' };
  mutate((s) => { rows(s, 'leads').unshift({ id: uid('ld'), name: v.name, company: v.company, email: v.email, kind: 'trial', at: today() }); rows(s, 'members').push({ id: uid('u'), email: v.email, name: v.name, role: 'owner', tenantId: 't1', title: 'Owner', status: 'active', branch: 'br_t1_1', mfa: false, lastSeen: '', password: v.password }); });
  return { ok: true, message: 'Account created.' };
}
export function acceptInvite(token: string): Res {
  const m = state.db.members.find((x) => x.status === 'invited' && x.email === token);
  if (!m) return { ok: false, error: 'This invitation is no longer valid. Ask the business owner to send a new one.' };
  update('members', m.id, { status: 'active' }); return { ok: true, message: 'Invitation accepted. You can sign in now.' };
}

// ---------- permissions ----------
export function can(perm: string, role = state.session?.role): boolean {
  if (!role) return false;
  if (state.session?.platformRole) return true;
  const def = state.db.roleDefs.find((r) => r.tenantId === state.session?.tenantId && r.name === role);
  return !!def?.permissions.includes(perm);
}

// ---------- numbering ----------
function takeNumber(s: State, p: string, date: string): string {
  const n = rows(s, 'numbering'); const i = n.findIndex((x) => x.tenantId === tid(s) && x.id.endsWith('_' + p));
  const row = n[i]; const num = docNumber(row.prefix, fiscalYear(date), row.nextSeq, row.padding); n[i] = { ...row, nextSeq: row.nextSeq + 1 }; return num;
}
const lockedPeriods = (s: State) => (s.db.periods ?? []).filter((p) => p.tenantId === tid(s));

// ---------- invoices ----------
export function saveInvoice(v: Row): Res {
  const s0 = state; const cust = s0.db.customers.find((c) => c.id === v.customerId);
  const T = TENANTS.find((t) => t.id === tid(s0))!;
  const intra = cust ? cust.state === T.state : true; const totals = calcDoc(v.lines as Line[], { intraState: intra, docDiscountPct: v.docDiscountPct ?? 0 });
  let id = v.id as string | undefined;
  if (id) { const ex = s0.db.invoices.find((i) => i.id === id); if (ex && !['draft', 'pending_approval'].includes(ex.status)) return { ok: false, error: 'Issued invoices cannot be edited. Use a credit note and reissue.' }; }
  mutate((s) => {
    const a = rows(s, 'invoices'); const data = { customerId: v.customerId, customer: cust?.name ?? '', branchId: v.branchId, issueDate: v.issueDate, dueDate: v.dueDate, terms: v.terms, lines: v.lines, intraState: intra, docDiscountPct: v.docDiscountPct ?? 0, totals, total: totals.total, notes: v.notes ?? '', custom: v.custom ?? {} };
    if (id) { const i = a.findIndex((x) => x.id === id); a[i] = { ...a[i], ...data, history: [...a[i].history, { at: new Date().toISOString(), by: actor(s), what: 'Draft saved' }] }; }
    else { id = uid('in'); a.unshift({ id, tenantId: tid(s), number: '', status: 'draft', source: v.source ?? 'manual', delivery: 'not_sent', ...data, history: [{ at: new Date().toISOString(), by: actor(s), what: 'Created draft' }] }); }
  });
  return { ok: true, id };
}
export function submitInvoice(id: string): Res {
  const inv = state.db.invoices.find((i) => i.id === id)!; const errs = validateInvoice(inv as any); if (errs.length) return { ok: false, error: errs.join(' ') };
  const st = state.settings[tid(state)]; if (inv.total >= st.service.invoiceApprovalValue) { update('invoices', id, { status: 'pending_approval' }, 'Invoice submitted for approval'); return { ok: true, message: 'Sent for approval because it is above the approval threshold.' }; }
  return issueInvoice(id);
}
export function issueInvoice(id: string): Res {
  const inv = state.db.invoices.find((i) => i.id === id); if (!inv) return { ok: false, error: 'Invoice not found.' };
  if (!['draft', 'pending_approval'].includes(inv.status)) return { ok: false, error: 'This invoice is already issued.' };
  const errs = validateInvoice(inv as any); if (errs.length) return { ok: false, error: errs.join(' ') };
  if (periodLocked(inv.issueDate, lockedPeriods(state) as any)) return { ok: false, error: 'The issue date falls in a locked period. Choose a date in an open period or ask the owner to unlock it.' };
  const cu = state.db.customers.find((c) => c.id === inv.customerId); if (cu?.status === 'on_hold') return { ok: false, error: `${cu.name} is on hold. Release the hold before issuing.` };
  let num = '';
  mutate((s) => { num = takeNumber(s, 'INV', inv.issueDate); const a = rows(s, 'invoices'); const i = a.findIndex((x) => x.id === id); a[i] = { ...a[i], number: num, status: 'issued', delivery: 'not_sent', history: [...a[i].history, { at: new Date().toISOString(), by: actor(s), what: `Issued as ${num}` }] }; logAudit(s, `Invoice ${num} issued`, id); });
  return { ok: true, id, message: `Issued as ${num}` };
}
export function approveInvoice(id: string): Res { return issueInvoice(id); }
export function rejectInvoice(id: string, reason: string): Res { if (!reason.trim()) return { ok: false, error: 'A reason is required when rejecting.' }; update('invoices', id, { status: 'draft' }, `Invoice approval rejected: ${reason}`); return { ok: true }; }
export function deleteDraft(id: string): Res { const inv = state.db.invoices.find((i) => i.id === id); if (!inv || inv.status !== 'draft') return { ok: false, error: 'Only drafts can be deleted.' }; remove('invoices', id, 'Draft invoice deleted'); return { ok: true }; }
export function sendInvoice(id: string): Res {
  const inv = state.db.invoices.find((i) => i.id === id)!; if (['draft', 'pending_approval', 'void'].includes(inv.status)) return { ok: false, error: 'Only issued invoices can be sent.' };
  const ct = state.db.contacts.find((c) => c.customerId === inv.customerId && c.billing); if (!ct) return { ok: false, error: 'No billing contact on this customer.' };
  update('invoices', id, { delivery: 'delivered', history: [...inv.history, { at: new Date().toISOString(), by: actor(state), what: `Emailed to ${ct.email}` }] }, `Invoice ${inv.number} sent`); return { ok: true, message: `Sent to ${ct.email}` };
}
export function voidInvoice(id: string, reason: string): Res {
  const inv = state.db.invoices.find((i) => i.id === id)!; if (!reason.trim()) return { ok: false, error: 'A reason is required to void an invoice.' };
  const b = balances(state)[id]; if (b && b.allocated > 0) return { ok: false, error: 'This invoice has receipts allocated. Reverse them or issue a credit note instead.' };
  if (periodLocked(inv.issueDate, lockedPeriods(state) as any)) return { ok: false, error: 'This invoice is in a locked period. Issue a credit note dated in an open period.' };
  update('invoices', id, { status: 'void', voidReason: reason, history: [...inv.history, { at: new Date().toISOString(), by: actor(state), what: `Voided: ${reason}` }] }, `Invoice ${inv.number} voided`, true); return { ok: true };
}
/** Correction: full credit note against the original plus a fresh draft carrying the same lines. */
export function correctInvoice(id: string, reason: string): Res {
  const inv = state.db.invoices.find((i) => i.id === id)!; if (!reason.trim()) return { ok: false, error: 'A reason is required for a correction.' };
  const b = balances(state)[id]; if (b.out <= 0) return { ok: false, error: 'Nothing is outstanding on this invoice. Refund the paid amount from Receipts.' };
  const adj = createAdjustment({ kind: 'credit', invoiceId: id, amount: b.out, reason: `Correction: ${reason}` }); if (!adj.ok) return adj;
  const draft = saveInvoice({ customerId: inv.customerId, branchId: inv.branchId, issueDate: today(), dueDate: addDays(today(), inv.terms), terms: inv.terms, lines: inv.lines, docDiscountPct: inv.docDiscountPct, notes: `Replaces ${inv.number}. ${reason}`, source: 'correction', custom: inv.custom });
  return { ok: true, id: draft.ok ? draft.id : undefined, message: 'Credit note raised and a replacement draft created.' };
}

// ---------- quotes ----------
export function saveQuote(v: Row): Res {
  const cust = state.db.customers.find((c) => c.id === v.customerId); if (!cust) return { ok: false, error: 'Choose a customer.' };
  if (!v.lines?.length) return { ok: false, error: 'Add at least one line.' };
  const T = TENANTS.find((t) => t.id === tid(state))!; const totals = calcDoc(v.lines, { intraState: cust.state === T.state, docDiscountPct: v.docDiscountPct ?? 0 });
  const st = state.settings[tid(state)].service; const needs = (v.docDiscountPct ?? 0) > st.discountApprovalPct || totals.total >= st.quoteApprovalValue;
  let id = v.id as string | undefined;
  mutate((s) => {
    const a = rows(s, 'quotes');
    if (id) { const i = a.findIndex((x) => x.id === id); const ex = a[i]; const bump = ['sent', 'declined', 'expired', 'accepted'].includes(ex.status) && ex.total !== totals.total; const rev = bump ? ex.revision + 1 : ex.revision; a[i] = { ...ex, customerId: cust.id, customer: cust.name, validUntil: v.validUntil, lines: v.lines, docDiscountPct: v.docDiscountPct ?? 0, totals, total: totals.total, terms: v.terms, approval: needs ? 'required' : 'not_required', revision: rev, status: bump ? 'draft' : ex.status, revisions: bump || ex.total !== totals.total ? [...ex.revisions, { rev: Math.max(rev, ex.revisions.length + 1), at: today(), by: actor(s), note: v.note || 'Edited', total: totals.total }] : ex.revisions }; }
    else { id = uid('qt'); a.unshift({ id, tenantId: tid(s), number: '', customerId: cust.id, customer: cust.name, status: 'draft', date: today(), validUntil: v.validUntil, lines: v.lines, intraState: cust.state === T.state, docDiscountPct: v.docDiscountPct ?? 0, totals, total: totals.total, terms: v.terms, revision: 1, revisions: [{ rev: 1, at: today(), by: actor(s), note: 'First version', total: totals.total }], acceptedBy: '', acceptedRev: 0, approval: needs ? 'required' : 'not_required', convertedTo: '' }); }
  });
  return { ok: true, id };
}
export function quoteAction(id: string, what: 'request_approval' | 'approve' | 'reject' | 'send' | 'accept' | 'decline' | 'expire' | 'reopen', extra: Row = {}): Res {
  const q = state.db.quotes.find((x) => x.id === id)!; const set = (p: Row, a: string) => { update('quotes', id, p, a); return { ok: true } as Res; };
  switch (what) {
    case 'request_approval': if (q.approval !== 'required') return { ok: false, error: 'This quotation does not need approval.' }; return set({ status: 'pending_approval' }, `Quotation ${q.number || q.id} sent for approval`);
    case 'approve': if (q.status !== 'pending_approval') return { ok: false, error: 'Not awaiting approval.' }; return set({ status: 'draft', approval: 'approved', approvedBy: actor(state) }, 'Quotation approved');
    case 'reject': if (!extra.reason?.trim()) return { ok: false, error: 'A reason is required when rejecting.' }; return set({ status: 'draft', approval: 'rejected', rejectReason: extra.reason }, 'Quotation approval rejected: ' + extra.reason);
    case 'send': { if (q.approval === 'required') return { ok: false, error: 'This quotation needs internal approval before it can be sent.' }; if (!['draft'].includes(q.status)) return { ok: false, error: 'Only draft quotations can be sent.' }; let num = q.number; if (!num) mutate((s) => { num = takeNumber(s, 'QT', today()); }); return set({ status: 'sent', number: num, sentOn: today() }, `Quotation ${num} sent`); }
    case 'accept': { if (q.status !== 'sent') return { ok: false, error: 'Only sent quotations can be accepted.' }; if (q.validUntil < today()) return { ok: false, error: 'This quotation has expired.' }; const c = state.db.contacts.find((x) => x.id === extra.contactId && x.customerId === q.customerId && x.authorisedToAccept); if (!c) return { ok: false, error: 'Choose an authorised contact.' }; return set({ status: 'accepted', acceptedBy: `${c.name} (${c.role})`, acceptedRev: q.revision, acceptedOn: today() }, `Quotation ${q.number} accepted (revision ${q.revision})`); }
    case 'decline': if (q.status !== 'sent') return { ok: false, error: 'Only sent quotations can be declined.' }; return set({ status: 'declined', declineReason: extra.reason ?? '' }, `Quotation ${q.number} declined`);
    case 'expire': if (q.status !== 'sent') return { ok: false, error: 'Only sent quotations can expire.' }; return set({ status: 'expired' }, `Quotation ${q.number} expired`);
    case 'reopen': if (!['declined', 'expired'].includes(q.status)) return { ok: false, error: 'Nothing to reopen.' }; return set({ status: 'draft', validUntil: addDays(today(), 14) }, 'Quotation reopened as draft');
  }
}
export function convertQuote(id: string, to: 'invoice' | 'schedule', freq: 'monthly' | 'quarterly' | 'yearly' = 'monthly'): Res {
  const q = state.db.quotes.find((x) => x.id === id)!; if (q.status !== 'accepted') return { ok: false, error: 'Only accepted quotations can be converted.' };
  const cu = state.db.customers.find((c) => c.id === q.customerId)!;
  if (to === 'invoice') { const r = saveInvoice({ customerId: q.customerId, branchId: `br_${tid(state)}_1`, issueDate: today(), dueDate: addDays(today(), cu.terms), terms: cu.terms, lines: q.lines, docDiscountPct: q.docDiscountPct, notes: `From quotation ${q.number} (revision ${q.acceptedRev})`, source: 'quote' }); if (!r.ok) return r; update('quotes', id, { status: 'converted', convertedTo: r.id }, `Quotation ${q.number} converted to invoice draft`); return { ok: true, id: r.id, message: 'Invoice draft created from the accepted quotation.' }; }
  const sc = insert('schedules', { name: `${q.customer} – from ${q.number}`, customerId: q.customerId, customer: q.customer, frequency: freq, start: today(), end: '', nextRun: today(), status: 'active', lines: q.lines, total: q.total, intraState: q.intraState, autoCollect: false, runs: [], lastError: '' }, `Schedule created from quotation ${q.number}`);
  update('quotes', id, { status: 'converted', convertedTo: sc.id }); return { ok: true, id: sc.id, message: 'Billing schedule created.' };
}

// ---------- receipts & allocation ----------
export function recordReceipt(v: Row): Res {
  if (!v.customerId) return { ok: false, error: 'Choose a customer.' }; if (!(v.amount > 0)) return { ok: false, error: 'Amount must be greater than zero.' };
  if (!v.date) return { ok: false, error: 'Receipt date is required.' };
  if (v.date > today()) return { ok: false, error: 'Receipt date cannot be in the future.' };
  if (periodLocked(v.date, lockedPeriods(state) as any)) return { ok: false, error: 'That date is in a locked period.' };
  const dupe = state.db.receipts.find((r) => r.tenantId === tid(state) && ((v.ref && r.ref === v.ref) || (v.providerEventId && r.providerEventId === v.providerEventId)));
  if (dupe) return { ok: false, error: `Duplicate: ${dupe.number} already uses reference ${dupe.ref}. Nothing was credited twice.` };
  const cu = state.db.customers.find((c) => c.id === v.customerId)!; let id = '';
  mutate((s) => { const number = takeNumber(s, 'RCT', v.date); id = uid('rc'); rows(s, 'receipts').unshift({ id, tenantId: tid(s), number, customerId: cu.id, customer: cu.name, date: v.date, amount: v.amount, mode: v.mode, ref: v.ref ?? '', providerStatus: v.mode === 'card' || v.mode === 'payment_link' ? 'captured' : 'n/a', status: 'unapplied', providerEventId: v.providerEventId ?? '', notes: v.notes ?? '' }); logAudit(s, `Receipt ${number} recorded`, id); });
  if (v.invoiceId) { const r = allocate(id, [{ invoiceId: v.invoiceId, amount: Math.min(v.amount, balances(state)[v.invoiceId]?.out ?? 0) }]); if (!r.ok) return { ok: true, id, message: `Receipt saved as unapplied. ${r.error}` }; }
  return { ok: true, id, message: 'Receipt recorded.' };
}
export function allocate(receiptId: string, reqs: { invoiceId: string; amount: number }[]): Res {
  const rc = state.db.receipts.find((r) => r.id === receiptId)!; const allocs = state.db.allocations.filter((a) => a.tenantId === tid(state)); const bal = balances(state);
  if (['reversed', 'refunded'].includes(rc.status)) return { ok: false, error: 'This receipt is reversed and cannot be allocated.' };
  const wrong = reqs.find((r) => state.db.invoices.find((i) => i.id === r.invoiceId)?.customerId !== rc.customerId); if (wrong) return { ok: false, error: 'You can only allocate to invoices of the same customer.' };
  const chk = checkAllocation(receiptUnapplied(rc, allocs), reqs.map((r) => ({ amount: r.amount, invoiceOutstanding: bal[r.invoiceId]?.out ?? 0 }))); if (!chk.ok) return { ok: false, error: chk.error! };
  mutate((s) => { reqs.forEach((r) => rows(s, 'allocations').push({ id: uid('al'), tenantId: tid(s), receiptId, invoiceId: r.invoiceId, amount: r.amount, at: today(), by: actor(s), reversed: false })); const a = rows(s, 'receipts'); const i = a.findIndex((x) => x.id === receiptId); const left = receiptUnapplied(a[i], s.db.allocations.filter((x) => x.tenantId === tid(s))); a[i] = { ...a[i], status: left === 0 ? 'applied' : 'unapplied' }; logAudit(s, `Receipt ${rc.number} allocated`, receiptId); });
  return { ok: true, message: 'Allocated.' };
}
export function reverseReceipt(receiptId: string, reason: string, refund = false): Res {
  const rc = state.db.receipts.find((r) => r.id === receiptId)!; if (!reason.trim()) return { ok: false, error: 'A reason is required.' };
  if (['reversed', 'refunded'].includes(rc.status)) return { ok: false, error: 'Already reversed.' };
  if (periodLocked(rc.date, lockedPeriods(state) as any)) return { ok: false, error: 'This receipt is in a locked period. Record a refund dated today instead.' };
  mutate((s) => { s.db.allocations = rows(s, 'allocations').map((a) => (a.receiptId === receiptId ? { ...a, reversed: true } : a)); const r = rows(s, 'receipts'); const i = r.findIndex((x) => x.id === receiptId); r[i] = { ...r[i], status: refund ? 'refunded' : 'reversed', reverseReason: reason }; logAudit(s, `Receipt ${rc.number} ${refund ? 'refunded' : 'reversed'}: ${reason}`, receiptId, true); });
  return { ok: true, message: refund ? 'Refunded. Invoice balances restored.' : 'Reversed. Invoice balances restored.' };
}
export function unallocate(allocId: string, reason: string): Res {
  if (!reason.trim()) return { ok: false, error: 'A reason is required.' }; const a = state.db.allocations.find((x) => x.id === allocId)!;
  update('allocations', allocId, { reversed: true }, 'Allocation removed: ' + reason, true); const rc = state.db.receipts.find((r) => r.id === a.receiptId)!; update('receipts', rc.id, { status: 'unapplied' }); return { ok: true };
}
/** Provider callback. Replays of the same event id are acknowledged without crediting again. */
export function providerCallback(eventId: string, v: Row): Res {
  if (state.db.receipts.some((r) => r.providerEventId === eventId)) return { ok: true, message: 'Duplicate callback ignored (already processed).' };
  return recordReceipt({ ...v, providerEventId: eventId, mode: 'payment_link' });
}

// ---------- credits & disputes ----------
export function createAdjustment(v: Row): Res {
  const inv = state.db.invoices.find((i) => i.id === v.invoiceId); if (!inv) return { ok: false, error: 'Choose a linked invoice.' };
  if (!v.reason?.trim()) return { ok: false, error: 'A reason is required.' };
  const b = balances(state)[inv.id]; const chk = checkAdjustment(v.kind, v.amount, b.out, inv.total); if (!chk.ok) return { ok: false, error: chk.error! };
  const date = v.date ?? today(); if (periodLocked(date, lockedPeriods(state) as any)) return { ok: false, error: 'That date is in a locked period.' };
  const st = state.settings[tid(state)]; let id = '';
  mutate((s) => { const number = takeNumber(s, v.kind === 'credit' ? 'CN' : 'DN', date); id = uid('cr'); rows(s, 'credits').unshift({ id, tenantId: tid(s), number, kind: v.kind, invoiceId: inv.id, invoiceNumber: inv.number, customerId: inv.customerId, customer: inv.customer, amount: v.amount, reason: v.reason, status: 'pending', requestedBy: actor(s), approvedBy: '', date, period: fiscalYear(date) }); logAudit(s, `${v.kind === 'credit' ? 'Credit' : 'Debit'} note ${number} requested`, id); });
  void st; return { ok: true, id, message: 'Submitted for approval.' };
}
export function decideAdjustment(id: string, approve: boolean, reason = ''): Res {
  const c = state.db.credits.find((x) => x.id === id)!; if (c.status !== 'pending') return { ok: false, error: 'Already decided.' };
  if (state.session?.name === c.requestedBy) return { ok: false, error: 'You cannot approve an adjustment you requested.' };
  if (!approve && !reason.trim()) return { ok: false, error: 'A reason is required when rejecting.' };
  if (approve) { const b = balances(state)[c.invoiceId]; const chk = checkAdjustment(c.kind, c.amount, b.out, state.db.invoices.find((i) => i.id === c.invoiceId)!.total); if (!chk.ok) return { ok: false, error: chk.error! }; }
  update('credits', id, approve ? { status: 'approved', approvedBy: actor(state) } : { status: 'rejected', rejectReason: reason }, `${c.number} ${approve ? 'approved' : 'rejected'}`, true); return { ok: true };
}
export function openDispute(v: Row): Res {
  const inv = state.db.invoices.find((i) => i.id === v.invoiceId); if (!inv) return { ok: false, error: 'Choose an invoice.' }; if (!v.reason?.trim()) return { ok: false, error: 'Describe the reason for the dispute.' };
  const b = balances(state)[inv.id]; if (!(v.amount > 0) || v.amount > b.out) return { ok: false, error: 'Disputed amount must be between ₹0.01 and the outstanding balance.' };
  const d = insert('disputes', { invoiceId: inv.id, invoiceNumber: inv.number, customerId: inv.customerId, customer: inv.customer, amount: v.amount, reason: v.reason, status: 'open', opened: today(), owner: 'Rohan Iyer', pausesReminders: state.settings[tid(state)].service.disputePausesReminders, outcome: '' }, 'Dispute opened on ' + inv.number);
  insert('disputeEvents', { disputeId: d.id, at: new Date().toISOString(), by: actor(state), what: 'Dispute raised', evidence: v.evidence ?? '' }); return { ok: true, id: d.id };
}
export function disputeEvent(id: string, what: string, evidence = ''): Res { if (!what.trim() && !evidence.trim()) return { ok: false, error: 'Add a note or attach evidence.' }; insert('disputeEvents', { disputeId: id, at: new Date().toISOString(), by: actor(state), what: what || 'Evidence added', evidence }); if (state.db.disputes.find((d) => d.id === id)?.status === 'open') update('disputes', id, { status: 'under_review' }); return { ok: true }; }
export function resolveDispute(id: string, outcome: 'credit' | 'reject' | 'reallocate', reason: string): Res {
  const d = state.db.disputes.find((x) => x.id === id)!; if (!reason.trim()) return { ok: false, error: 'A resolution note is required.' };
  if (!['open', 'under_review'].includes(d.status)) return { ok: false, error: 'This dispute is already closed.' };
  if (outcome === 'credit') { const r = createAdjustment({ kind: 'credit', invoiceId: d.invoiceId, amount: d.amount, reason: `Dispute resolution: ${reason}` }); if (!r.ok) return r; update('disputes', id, { status: 'resolved', outcome: 'Credit note requested: ' + reason }, 'Dispute resolved with credit'); }
  else update('disputes', id, { status: outcome === 'reject' ? 'rejected' : 'resolved', outcome: reason }, 'Dispute ' + outcome);
  insert('disputeEvents', { disputeId: id, at: new Date().toISOString(), by: actor(state), what: `Resolved (${outcome}): ${reason}`, evidence: '' }); return { ok: true };
}

// ---------- collections ----------
export function sendReminder(customerId: string, templateName: string): Res {
  const cu = state.db.customers.find((c) => c.id === customerId)!; const st = state.settings[tid(state)].service; const bal = balances(state);
  const open = state.db.invoices.filter((i) => i.customerId === customerId && (bal[i.id]?.out ?? 0) > 0);
  const payable = open.filter((i) => (bal[i.id]?.out ?? 0) - (st.disputePausesReminders ? bal[i.id].disputed : 0) > 0);
  if (!payable.length) return { ok: false, error: 'Nothing to remind: all balances are paid, or paused by disputes.' };
  const ct = state.db.contacts.find((c) => c.customerId === customerId && c.billing); if (!ct) return { ok: false, error: 'No billing contact.' };
  const tpl = state.db.templates.find((t) => t.tenantId === tid(state) && t.name === templateName); if (tpl && !tpl.reviewed) return { ok: false, error: 'This template has not been reviewed and activated.' };
  insert('reminderLog', { customerId, customer: cu.name, template: templateName, channel: 'email', at: new Date().toISOString(), status: 'delivered', error: '' }, 'Reminder sent to ' + cu.name); return { ok: true, message: `Reminder emailed to ${ct.email} for ${payable.length} invoice(s).` };
}
export function logContact(v: Row): Res { if (!v.customerId || !v.note?.trim()) return { ok: false, error: 'Choose a customer and add a note.' }; const cu = state.db.customers.find((c) => c.id === v.customerId)!; insert('contactLog', { customerId: cu.id, customer: cu.name, at: new Date().toISOString(), channel: v.channel, by: actor(state), note: v.note }); return { ok: true }; }
export function addPromise(v: Row): Res {
  const cu = state.db.customers.find((c) => c.id === v.customerId); if (!cu) return { ok: false, error: 'Choose a customer.' }; if (!(v.amount > 0)) return { ok: false, error: 'Enter the promised amount.' }; if (!v.promisedOn || v.promisedOn < today()) return { ok: false, error: 'Promise date must be today or later.' };
  insert('promises', { customerId: cu.id, customer: cu.name, amount: v.amount, promisedOn: v.promisedOn, madeOn: today(), status: 'open', owner: v.owner || actor(state), escalated: false }, 'Promise to pay recorded'); return { ok: true };
}

// ---------- payables ----------
export function saveBill(v: Row): Res {
  const sp = state.db.suppliers.find((x) => x.id === v.supplierId); if (!sp) return { ok: false, error: 'Choose a supplier.' }; if (!v.ref?.trim()) return { ok: false, error: 'Bill reference is required.' }; if (!(v.amount > 0)) return { ok: false, error: 'Amount must be greater than zero.' };
  if (isDuplicateBill(sp.id, v.ref, state.db.bills.filter((b) => b.tenantId === tid(state)) as any)) return { ok: false, error: `Duplicate: ${sp.name} already has a bill with reference ${v.ref}.` };
  const b = insert('bills', { supplierId: sp.id, supplier: sp.name, ref: v.ref.trim(), date: v.date, dueDate: v.dueDate || addDays(v.date, sp.terms), amount: v.amount, category: v.category, status: 'pending_review', attachment: v.attachment ?? '', notes: v.notes ?? '' }, 'Vendor bill ' + v.ref + ' recorded'); return { ok: true, id: b.id };
}
export const billPaid = (bill: Row, pays: Row[]) => pays.filter((p) => p.billId === bill.id).reduce((s, p) => s + p.amount, 0);
export function payBill(billId: string, amount: number, mode: string, ref: string): Res {
  const b = state.db.bills.find((x) => x.id === billId)!; if (b.status === 'pending_review') return { ok: false, error: 'Approve the bill before paying it.' };
  const paid = billPaid(b, state.db.supplierPayments); if (!(amount > 0)) return { ok: false, error: 'Enter an amount.' }; if (amount > b.amount - paid) return { ok: false, error: 'Payment exceeds the bill balance.' };
  const sp = state.db.suppliers.find((x) => x.id === b.supplierId)!; if (sp.bankChangePending) return { ok: false, error: 'Supplier bank details have a pending change awaiting approval. Payment is blocked.' };
  insert('supplierPayments', { billId, supplierId: b.supplierId, supplier: b.supplier, amount, date: today(), mode, ref }, `Payment recorded against ${b.ref}`);
  if (paid + amount === b.amount) update('bills', billId, { status: 'paid' }); return { ok: true, message: paid + amount === b.amount ? 'Bill fully paid.' : 'Partial payment recorded.' };
}

// ---------- reconciliation ----------
export function parseStatement(text: string): { rows: Row[]; errors: { row: number; error: string }[] } {
  const out: Row[] = []; const errors: { row: number; error: string }[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    if (i === 0 && /date/i.test(line)) return; const p = line.split(',').map((x) => x.trim());
    if (p.length < 5) return errors.push({ row: i + 1, error: 'Expected: date,description,reference,amount,in|out' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p[0])) return errors.push({ row: i + 1, error: `Date "${p[0]}" must be YYYY-MM-DD` });
    const amt = Math.round(parseFloat(p[3]) * 100); if (!Number.isFinite(amt) || amt <= 0) return errors.push({ row: i + 1, error: `Amount "${p[3]}" is not a positive number` });
    if (!['in', 'out'].includes(p[4].toLowerCase())) return errors.push({ row: i + 1, error: 'Direction must be in or out' });
    out.push({ date: p[0], desc: p[1], ref: p[2], amount: amt, direction: p[4].toLowerCase() });
  }); return { rows: out, errors };
}
export function importStatement(text: string, file = 'pasted.csv'): Res {
  const { rows: parsed, errors } = parseStatement(text); if (!parsed.length && errors.length) return { ok: false, error: `No rows imported. ${errors[0].error} (row ${errors[0].row}).` };
  let added = 0, dupes = 0; const existing = state.db.bankTx.filter((b) => b.tenantId === tid(state));
  const cand = state.db.receipts.filter((r) => r.tenantId === tid(state)).map((r) => ({ id: r.id, ref: r.ref, amount: r.amount, date: r.date }));
  parsed.forEach((p) => { const dup = existing.some((e) => e.ref && e.ref === p.ref && e.amount === p.amount && e.date === p.date); const m = p.direction === 'in' ? suggestMatch({ id: '', ...p } as any, cand) : null; insert('bankTx', { ...p, source: 'csv', status: dup ? 'duplicate' : 'unmatched', matchedTo: '', suggestion: m?.id ?? '', suggestionKind: m?.confidence ?? '', approved: false }); dup ? dupes++ : added++; });
  const imp = insert('imports', { kind: 'Bank statement', file, rows: parsed.length, errors: errors.length, status: errors.length ? 'completed_with_errors' : 'completed', at: today(), by: actor(state) }, `Statement ${file} imported`);
  errors.forEach((e) => insert('importRows', { importId: imp.id, row: e.row, field: 'row', error: e.error, value: '' })); return { ok: true, message: `${added} imported, ${dupes} flagged duplicate, ${errors.length} row error(s).` };
}
export function matchTx(txId: string, targetId: string): Res {
  const tx = state.db.bankTx.find((b) => b.id === txId)!; const target = state.db.receipts.find((r) => r.id === targetId) ?? state.db.supplierPayments.find((p) => p.id === targetId); if (!target) return { ok: false, error: 'Choose a target.' };
  if (target.amount !== tx.amount) return { ok: false, error: 'Amounts differ. Mark it as a discrepancy and resolve it instead of forcing a match.' };
  if (state.db.bankTx.some((b) => b.matchedTo === targetId && b.id !== txId && b.status === 'matched')) return { ok: false, error: 'That record is already matched to another bank row.' };
  update('bankTx', txId, { status: 'matched', matchedTo: targetId }, 'Bank row matched'); return { ok: true };
}
export function approveRecon(txId: string): Res { const tx = state.db.bankTx.find((b) => b.id === txId)!; if (tx.status !== 'matched') return { ok: false, error: 'Only matched rows can be approved.' }; update('bankTx', txId, { approved: true }, 'Reconciliation approved', true); return { ok: true }; }
export function runExport(period: string): Res {
  const t = tid(state); const unrec = state.db.bankTx.filter((b) => b.tenantId === t && b.status === 'matched' && !b.approved).length + state.db.bankTx.filter((b) => b.tenantId === t && ['unmatched', 'discrepancy'].includes(b.status)).length;
  const bal = state.db.invoices.filter((i) => i.tenantId === t && i.status !== 'draft').length;
  if (unrec > 0) { insert('exports', { kind: 'Accounting CSV', period, rows: 0, status: 'failed', at: new Date().toISOString(), by: actor(state), error: `${unrec} bank row(s) are not reconciled and approved` }); return { ok: false, error: `Export blocked: ${unrec} bank row(s) not reconciled and approved.` }; }
  insert('exports', { kind: 'Accounting CSV', period, rows: bal, status: 'succeeded', at: new Date().toISOString(), by: actor(state) }, 'Accounting export ' + period); return { ok: true, message: `Exported ${bal} rows.` };
}
export function retryExport(id: string): Res { const e = state.db.exports.find((x) => x.id === id)!; const r = runExport(e.period); if (r.ok) update('exports', id, { status: 'superseded' }); return r; }

// ---------- schedules ----------
export function runSchedule(id: string): Res {
  const sc = state.db.schedules.find((x) => x.id === id)!; if (sc.status !== 'active') return { ok: false, error: 'Resume the schedule first.' };
  const period = sc.nextRun.slice(0, 7); if (sc.runs.some((r: Row) => r.period === period && r.invoice && sc.frequency !== 'weekly')) return { ok: false, error: `Period ${period} was already invoiced. Duplicate prevented.` };
  const cu = state.db.customers.find((c) => c.id === sc.customerId)!; if (cu.status === 'on_hold') { update('schedules', id, { lastError: 'Customer on hold – run skipped' }); return { ok: false, error: 'Customer is on hold; run skipped.' }; }
  const d = saveInvoice({ customerId: sc.customerId, branchId: `br_${tid(state)}_1`, issueDate: today(), dueDate: addDays(today(), cu.terms), terms: cu.terms, lines: sc.lines, notes: `Recurring: ${sc.name} (${period})`, source: 'schedule' }); if (!d.ok) return d;
  const iss = issueInvoice(d.id!); const inv = state.db.invoices.find((i) => i.id === d.id)!;
  const next = nextRun(sc.nextRun, sc.frequency); const ended = sc.end && next > sc.end;
  update('schedules', id, { runs: [...sc.runs, { period, invoice: inv.number || inv.id, at: today() }], nextRun: next, status: ended ? 'ended' : sc.status, lastError: iss.ok ? '' : iss.error }, `Schedule ${sc.name} ran`); return iss.ok ? { ok: true, id: d.id, message: `Generated ${inv.number}.` } : { ok: true, id: d.id, message: 'Draft generated; issue failed: ' + iss.error };
}

// ---------- subscription ----------
export function changePlan(planId: string, cycle: string): Res {
  const plan = state.db.plans.find((p) => p.id === planId && p.active)!; const sub = state.db.subscriptions.find((x) => x.tenantId === tid(state))!;
  const over: string[] = []; if (sub.usersUsed > plan.users) over.push(`${sub.usersUsed - plan.users} user(s)`); if (sub.branchesUsed > plan.branches) over.push(`${sub.branchesUsed - plan.branches} branch(es)`);
  if (over.length) return { ok: false, error: `${plan.name} allows ${plan.users} users and ${plan.branches} branches. Remove ${over.join(' and ')} first, or choose a larger plan.` };
  update('subscriptions', sub.id, { planId, planVersion: plan.version, cycle }, `Plan changed to ${plan.name} (${cycle})`, true); return { ok: true, message: `Now on ${plan.name}, ${cycle}.` };
}
export function cancelSubscription(reason: string): Res { if (!reason.trim()) return { ok: false, error: 'Tell us why you are cancelling.' }; const sub = state.db.subscriptions.find((x) => x.tenantId === tid(state))!; update('subscriptions', sub.id, { status: 'cancelling', cancelAt: sub.renewsOn, cancelReason: reason }, 'Subscription cancellation scheduled', true); return { ok: true, message: `Access continues until ${sub.renewsOn}. Export your data before then.` }; }
export function retryRenewal(): Res { const sub = state.db.subscriptions.find((x) => x.tenantId === tid(state))!; if (!sub.renewalFailure) return { ok: false, error: 'No failed renewal to retry.' }; update('subscriptions', sub.id, { renewalFailure: false, status: 'active' }, 'Renewal retried successfully'); return { ok: true, message: 'Payment collected.' }; }

export function ensureSettings(tenant: string) { if (!state.settings[tenant]) mutate((s) => { s.settings[tenant] = DEFAULT_SETTINGS(tenant); }); }
export function saveSettings(path: string, values: Row, audit?: string) { mutate((s) => { const t = tid(s); s.settings[t] = { ...s.settings[t], [path]: { ...s.settings[t][path], ...values } }; logAudit(s, audit ?? `Settings updated: ${path}`, path); }); }
export function mark(c: string, id: string, patch: Row) { update(c, id, patch); }

// ---------- team ----------
export function inviteMember(v: Row): Res {
  if (!/^\S+@\S+\.\S+$/.test(v.email ?? '')) return { ok: false, error: 'Enter a valid email address.' };
  if (!v.name?.trim()) return { ok: false, error: 'Name is required.' };
  const sub = state.db.subscriptions.find((x) => x.tenantId === tid(state)); const plan = state.db.plans.find((p) => p.id === sub?.planId);
  const count = state.db.members.filter((m) => m.tenantId === tid(state) && m.status !== 'suspended').length;
  if (plan && count >= plan.users) return { ok: false, error: `Your ${plan.name} plan allows ${plan.users} users. Upgrade or suspend someone first.` };
  if (state.db.members.some((m) => m.tenantId === tid(state) && m.email.toLowerCase() === v.email.toLowerCase() && m.status !== 'suspended')) return { ok: false, error: 'That person is already a member or has a pending invitation.' };
  insert('members', { email: v.email.trim(), name: v.name.trim(), role: v.role, title: v.title ?? '', status: 'invited', branch: v.branch, mfa: false, lastSeen: '', password: 'demo' }, `Invited ${v.email} as ${v.role}`);
  return { ok: true, message: `Invitation sent to ${v.email}.` };
}
export function setMemberStatus(id: string, status: 'active' | 'suspended', reason = ''): Res {
  const m = state.db.members.find((x) => x.id === id)!;
  if (m.email === state.session?.email && status === 'suspended') return { ok: false, error: 'You cannot suspend your own account.' };
  if (status === 'suspended') {
    if (!reason.trim()) return { ok: false, error: 'A reason is required.' };
    const owners = state.db.members.filter((x) => x.tenantId === m.tenantId && x.role === 'owner' && x.status === 'active');
    if (m.role === 'owner' && owners.length <= 1) return { ok: false, error: 'This is the only owner. Assign another owner first.' };
  }
  update('members', id, { status, suspendReason: reason }, `${status === 'suspended' ? 'Suspended' : 'Reinstated'} ${m.email}${reason ? ': ' + reason : ''}`, true);
  return { ok: true, message: status === 'suspended' ? 'Suspended. Their sessions end immediately.' : 'Reinstated.' };
}
export function setRolePermission(role: string, perm: string, on: boolean): Res {
  if (role === 'owner') return { ok: false, error: 'The owner role always has every permission.' };
  const d = state.db.roleDefs.find((r) => r.tenantId === tid(state) && r.name === role)!;
  const permissions = on ? [...new Set([...d.permissions, perm])] : d.permissions.filter((p: string) => p !== perm);
  if (!permissions.includes('view') && permissions.length) return { ok: false, error: 'Every role that can do anything must be able to view.' };
  update('roleDefs', d.id, { permissions }, `Role ${role}: ${perm} ${on ? 'granted' : 'revoked'}`, ['refund', 'export', 'configure', 'approve'].includes(perm));
  return { ok: true };
}

export function setBranch(branchId: string) { mutate((s) => { s.flags.branchId = branchId || undefined; }); }
