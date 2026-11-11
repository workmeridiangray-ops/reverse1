import { addDays, iso, today, addMonths } from '../lib/format';
import { calcDoc, docNumber, fiscalYear, type Line } from '../lib/rules';

export type Row = Record<string, any>;
export type DB = Record<string, Row[]>;

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const TENANTS = [
  { id: 't1', name: 'Northwind Distributors Pvt Ltd', short: 'Northwind', state: 'MH', gstin: '27AABCN4821K1Z5', city: 'Mumbai', prefix: 'NW' },
  { id: 't2', name: 'Kestrel Advisory LLP', short: 'Kestrel', state: 'KA', gstin: '29AAFFK7712M1Z2', city: 'Bengaluru', prefix: 'KA' },
];
export interface TenantMeta { id: string; name: string; short: string; state: string; gstin: string; city: string; prefix: string }
const extraTenants = new Map<string, TenantMeta>();
export function registerTenant(m: TenantMeta) { extraTenants.set(m.id, m); }
/** Businesses created after the demo seed (self-service signup) register their details here. */
export function tenantMeta(id: string): TenantMeta { return TENANTS.find((t) => t.id === id) ?? extraTenants.get(id) ?? { id, name: id, short: id, state: 'MH', gstin: '', city: '', prefix: 'LL' }; }
export const ROLES = ['owner', 'manager', 'staff', 'customer'] as const;
export const PLATFORM_ROLES = ['platform_owner', 'platform_billing', 'platform_support', 'platform_techops'] as const;
export const PERMISSIONS = ['view', 'create', 'edit', 'approve', 'assign', 'export', 'refund', 'configure'] as const;
export const SENSITIVE = ['refund', 'export', 'configure', 'approve'];

const CUST = ['Aarav Textiles', 'Bhatia Steel Works', 'Cobalt Logistics', 'Deccan Foods', 'Everest Pharma', 'Falcon Packaging', 'Gandhi Hardware', 'Harbor Marine Supplies', 'Indus Electricals', 'Jaipur Handicrafts', 'Kaveri Agro', 'Lotus Retail', 'Mahavir Chemicals', 'Neelam Plastics', 'Orbit Components', 'Pioneer Auto Parts', 'Quest Engineering', 'Rajdhani Paper Mills', 'Sagar Seafoods', 'Tulsi Ayurveda', 'Udaan Couriers', 'Vertex Tools', 'Western Cables', 'Yash Furnishings', 'Zenith Print House'];
const SUPP = ['Apex Raw Materials', 'BlueLine Freight', 'CityNet Broadband', 'Dhruv Stationers', 'Evergreen Facilities', 'FleetCare Motors', 'Gamma Packaging Inputs', 'Horizon Cloud Services', 'Ironclad Security', 'Jyoti Utilities'];
const STATES = [['MH', 'Maharashtra'], ['KA', 'Karnataka'], ['GJ', 'Gujarat'], ['TN', 'Tamil Nadu'], ['DL', 'Delhi'], ['RJ', 'Rajasthan']];
const CITY: Record<string, string> = { MH: 'Pune', KA: 'Mysuru', GJ: 'Surat', TN: 'Chennai', DL: 'New Delhi', RJ: 'Jaipur' };
const FIRST = ['Anita', 'Rohan', 'Meera', 'Vikram', 'Sunita', 'Karan', 'Divya', 'Imran', 'Pooja', 'Arjun', 'Neha', 'Sameer'];
const LAST = ['Shah', 'Iyer', 'Kapoor', 'Reddy', 'Nair', 'Joshi', 'Mehta', 'Khan', 'Desai', 'Menon'];
const ITEMS: [string, string, number, number, string][] = [
  ['Industrial fasteners (box)', 'GOODS', 84000, 18, 'box'], ['Packaging film roll', 'GOODS', 146000, 18, 'roll'], ['Cotton fabric 40s', 'GOODS', 9800, 5, 'm'], ['Copper wire 2.5mm', 'GOODS', 212000, 18, 'coil'],
  ['Steel sheet 1.2mm', 'GOODS', 6850, 18, 'kg'], ['Safety gloves (pack)', 'GOODS', 32000, 12, 'pack'], ['Freight – local', 'SERVICE', 450000, 18, 'trip'], ['Installation service', 'SERVICE', 600000, 18, 'visit'],
  ['Annual maintenance', 'SERVICE', 2400000, 18, 'year'], ['Consulting – hourly', 'SERVICE', 250000, 18, 'hour'], ['Audit support retainer', 'SERVICE', 1800000, 18, 'month'], ['Training session', 'SERVICE', 750000, 18, 'day'],
  ['Spare parts kit', 'GOODS', 385000, 28, 'kit'], ['Printed labels (1000)', 'GOODS', 58000, 12, 'pack'],
];

export function seed(): DB {
  const now = today();
  const db: DB = {};
  const add = (c: string, r: Row) => ((db[c] ??= []).push(r), r);
  [
    'branches','legalEntities','customers','contacts','suppliers','items','units','taxes','quotes','invoices','schedules','receipts','allocations','credits','disputes','disputeEvents','reminderLog','contactLog','promises','expenses','bills','supplierPayments','bankTx','reconciliations','exports','templates','customFields','imports','audit','members','invites','roleDefs','supportAccess','integrations','webhookLogs','apiKeys','notifications','sessions','messages','subscriptions','subInvoices','paymentMethods','periods','numbering','portalLinks','importRows','failedExports','savedViews','jobs','paymentAttempts','reasonCodes','expenseCategories','paymentLinks',
    'biz','plans','coupons','incidents','platformStaff','platformAudit','platformPayments','announcements','leads','tickets','storageStats','deletionFailures','processingFailures','platformRefunds',
  ].forEach((c) => (db[c] = []));

  // ---------- platform level ----------
  const plans = [
    ['starter', 'Starter', 99900, 999000, 1, 1, 3, 'Single entity, 300 invoices/month, email support'],
    ['growth', 'Growth', 299900, 2999000, 3, 3, 10, 'Recurring billing, collections workflows, reconciliation'],
    ['scale', 'Scale', 699900, 6999000, 10, 10, 40, 'Multi-branch, API and webhooks, advanced reports'],
  ];
  plans.forEach(([id, name, m, y, ent, br, users, blurb]) => add('plans', { id, name, monthly: m, yearly: y, entities: ent, branches: br, users, blurb, version: 3, effectiveFrom: '2026-04-01', active: true }));
  add('plans', { id: 'starter-v2', name: 'Starter (v2, retired)', monthly: 79900, yearly: 799000, entities: 1, branches: 1, users: 3, blurb: 'Legacy pricing kept for historical billing', version: 2, effectiveFrom: '2025-04-01', active: false });
  [['LAUNCH20', 20, '2026-12-31', 38, 100], ['ANNUAL10', 10, '2027-03-31', 12, 0], ['PARTNER25', 25, '2026-09-30', 7, 50]].forEach(([code, p, exp, used, max]) => add('coupons', { id: 'cp_' + code, code, percent: p, expires: exp, used, max, active: String(exp) >= now }));
  const bizNames = ['Northwind Distributors', 'Kestrel Advisory', 'Saffron Spices Export', 'Lakeview Constructions', 'Meridian Clinics Supply', 'Pixel Print Studio', 'Ocean Breeze Seafoods', 'Tarang Electronics', 'Banyan Education Services', 'Quartz Mining Services', 'Helix Labs Trading', 'Monsoon Beverages', 'Aster Interiors', 'Granite Works'];
  const r0 = rng(99);
  bizNames.forEach((n, i) => {
    const planId = i < 2 ? 'growth' : ['starter', 'growth', 'scale'][Math.floor(r0() * 3)];
    const st = i === 2 ? 'trial' : i === 5 ? 'past_due' : i === 9 ? 'suspended' : i === 12 ? 'cancelled' : 'active';
    add('biz', { id: 'b' + i, tenantId: i < 2 ? 't' + (i + 1) : undefined, name: n, plan: planId, status: st, users: 2 + Math.floor(r0() * 12), invoices: Math.floor(r0() * 900), storageMb: Math.floor(r0() * 3200), created: addDays(now, -Math.floor(r0() * 400)), trialEnds: st === 'trial' ? addDays(now, 9) : '', owner: `owner@${n.split(' ')[0].toLowerCase()}.example`, onboarding: st === 'trial' ? Math.floor(r0() * 5) + 2 : 9 });
  });
  const pay = ['succeeded', 'succeeded', 'succeeded', 'pending', 'failed', 'disputed', 'refunded', 'succeeded'];
  for (let i = 0; i < 40; i++) { const b = db.biz[Math.floor(r0() * db.biz.length)]; add('platformPayments', { id: 'pp' + i, bizId: b.id, biz: b.name, amount: [99900, 299900, 699900, 2999000][Math.floor(r0() * 4)], status: pay[i % pay.length], ref: 'pay_' + (100000 + i * 37), date: addDays(now, -i * 3), reason: pay[i % pay.length] === 'failed' ? 'Card declined by issuer' : '' }); }
  [['Webhook delivery degraded', 'resolved', 'minor', -14], ['Email provider latency', 'resolved', 'minor', -6], ['Report generation queue backlog', 'monitoring', 'major', -1]].forEach(([t, s, sev, d], i) => add('incidents', { id: 'inc' + i, title: t, status: s, severity: sev, started: addDays(now, d as number), owner: 'platform_techops' }));
  [['Priya Raman', 'platform_owner'], ['Dev Malhotra', 'platform_billing'], ['Sara Thomas', 'platform_support'], ['Ishaan Rao', 'platform_techops']].forEach(([n, r], i) => add('platformStaff', { id: 'ps' + i, name: n, email: `${(n as string).split(' ')[0].toLowerCase()}@ledgerline.example`, role: r, status: 'active', mfa: true, lastSeen: addDays(now, -i) }));
  ['Recurring schedules now support quarterly and yearly frequencies', 'Reconciliation: duplicate detection on statement import', 'New ageing buckets and statement PDFs'].forEach((t, i) => add('announcements', { id: 'an' + i, title: t, audience: 'all businesses', published: addDays(now, -i * 12 - 2), status: 'published' }));
  ['Recurring invoice run', 'Statement import parse', 'Reminder email send', 'Accounting export', 'Webhook dispatch'].forEach((n, i) => add('jobs', { id: 'job' + i, name: n, bizId: 'b' + (i + 2), status: i < 3 ? 'failed' : 'ok', attempts: i < 3 ? 2 + i : 1, lastError: i < 3 ? ['Provider timeout after 30s', 'Row 14: amount not numeric', 'SMTP 451 temporary failure'][i] : '', at: addDays(now, -i), idempotencyKey: 'run-' + (7000 + i) }));
  for (let i = 0; i < 8; i++) add('tickets', { id: 'tk' + i, subject: ['Cannot allocate receipt', 'GST rate on service item', 'Statement import failed', 'Need to add user', 'Invoice PDF layout', 'Refund status', 'Reminder not sent', 'Export format question'][i], biz: bizNames[i + 2], status: ['open', 'open', 'pending', 'resolved'][i % 4], priority: ['high', 'normal', 'low'][i % 3], assignee: 'Sara Thomas', age: i + 1 });
  add('storageStats', { id: 'ss1', totalGb: 184, usedGb: 71, attachmentsGb: 52, backupsGb: 19, lastBackup: addDays(now, 0) + 'T02:00:00Z', lastRestoreTest: addDays(now, -21) });
  add('deletionFailures', { id: 'df1', biz: 'Granite Works', object: 'Attachment bucket', error: 'Retention hold in effect', at: addDays(now, -3), status: 'needs_review' });
  add('processingFailures', { id: 'pf1', biz: 'Pixel Print Studio', job: 'Webhook dispatch', error: 'Endpoint returned 503', at: addDays(now, -1), status: 'retrying' });
  add('platformRefunds', { id: 'rf1', biz: 'Pixel Print Studio', amount: 299900, reason: 'Duplicate renewal charge', status: 'pending_approval', requestedBy: 'Dev Malhotra', at: addDays(now, -2) });
  ['Approved sensitive access', 'Plan version 3 published', 'Coupon LAUNCH20 created', 'Refund requested'].forEach((a, i) => add('platformAudit', { id: 'pa' + i, at: addDays(now, -i * 2) + 'T10:00:00Z', actor: db.platformStaff[i % 4].name, action: a, target: 'platform' }));
  ['Anil from Pune Traders asked for a demo', 'Rhea from Bright Lines requested a demo'].forEach((t, i) => add('leads', { id: 'ld' + i, name: t.split(' from ')[0], company: t.split(' from ')[1].split(' ')[0], email: `lead${i}@example.com`, kind: 'demo', at: addDays(now, -i - 1) }));

  // ---------- tenant data ----------
  const users: [string, string, string, string, string][] = [
    ['owner@northwind.test', 'Meera Kulkarni', 'owner', 't1', 'Owner'], ['manager@northwind.test', 'Rohan Iyer', 'manager', 't1', 'Finance manager'], ['staff@northwind.test', 'Anita Shah', 'staff', 't1', 'Accounts executive'],
    ['owner@kestrel.test', 'Vikram Nair', 'owner', 't2', 'Owner'],
  ];
  users.forEach(([email, name, role, tenantId, title], i) => add('members', { id: 'u' + (i + 1), email, name, role, tenantId, title, status: 'active', branch: 'br_' + tenantId + '_1', mfa: i === 0, lastSeen: addDays(now, -i) + 'T09:30:00Z', password: 'demo' }));
  // multi-workspace: Meera also owns Kestrel (explicit workspace switch)
  add('members', { id: 'u1b', email: 'owner@northwind.test', name: 'Meera Kulkarni', role: 'manager', tenantId: 't2', title: 'Advisor', status: 'active', branch: 'br_t2_1', mfa: true, lastSeen: addDays(now, -1) + 'T09:30:00Z', password: 'demo' });
  add('members', { id: 'u5', email: 'invited@northwind.test', name: 'Pending Invitee', role: 'staff', tenantId: 't1', title: 'Collections', status: 'invited', branch: 'br_t1_2', mfa: false, lastSeen: '', password: 'demo' });
  add('members', { id: 'u6', email: 'former@northwind.test', name: 'Former Employee', role: 'staff', tenantId: 't1', title: 'AR clerk', status: 'suspended', branch: 'br_t1_1', mfa: false, lastSeen: addDays(now, -40) + 'T09:30:00Z', password: 'demo' });

  TENANTS.forEach((T, ti) => {
    const t = T.id; const r = rng(7 + ti * 101); const pick = <X,>(a: X[]) => a[Math.floor(r() * a.length)];
    const scale = ti === 0 ? 1 : 0.35;
    const T$ = (c: string, row: Row) => add(c, { tenantId: t, ...row });
    T$('branches', { id: `br_${t}_1`, name: `${T.city} HQ`, city: T.city, state: T.state, gstin: T.gstin, active: true });
    T$('branches', { id: `br_${t}_2`, name: ti === 0 ? 'Pune Depot' : 'Mumbai Office', city: ti === 0 ? 'Pune' : 'Mumbai', state: ti === 0 ? 'MH' : 'MH', gstin: ti === 0 ? '27AABCN4821K2Z4' : '27AAFFK7712M2Z1', active: true });
    T$('legalEntities', { id: `le_${t}`, name: T.name, pan: ti ? 'AAFFK7712M' : 'AABCN4821K', gstin: T.gstin, cin: ti ? 'AAB-1234' : 'U51909MH2012PTC231456', address: `14 Business Park, ${T.city}`, state: T.state, currency: 'INR', fyStart: 'April', roundTo: 'rupee', active: true });
    [['pcs', 'Pieces'], ['box', 'Box'], ['kg', 'Kilogram'], ['m', 'Metre'], ['hour', 'Hour'], ['day', 'Day'], ['month', 'Month'], ['year', 'Year'], ['trip', 'Trip'], ['visit', 'Visit'], ['roll', 'Roll'], ['coil', 'Coil'], ['pack', 'Pack'], ['kit', 'Kit']].forEach(([code, name]) => T$('units', { id: `un_${t}_${code}`, code, name, active: true }));
    [[0, 'Exempt / nil'], [5, 'GST 5%'], [12, 'GST 12%'], [18, 'GST 18%'], [28, 'GST 28%']].forEach(([rate, name]) => T$('taxes', { id: `tx_${t}_${rate}`, rate, name, hsnRequired: (rate as number) > 0, active: true }));
    const fy = fiscalYear(now);
    ([['INV', 'Invoice', 1], ['QT', 'Quotation', 1], ['RCT', 'Receipt', 1], ['CN', 'Credit note', 1], ['DN', 'Debit note', 1]] as const).forEach(([p, n]) => T$('numbering', { id: `nm_${t}_${p}`, prefix: `${T.prefix}-${p}`, name: n, nextSeq: 1, padding: 4, fy, reset: 'yearly' }));
    const fyStart = +now.slice(5, 7) >= 4 ? +now.slice(0, 4) : +now.slice(0, 4) - 1;
    for (let q = 0; q < 4; q++) { const s = addMonths(`${fyStart}-04-01`, q * 3); const e = addDays(addMonths(s, 3), -1); T$('periods', { id: `pd_${t}_${q}`, name: `Q${q + 1} FY ${fy}`, start: s, end: e, locked: e < addDays(now, -40) }); }
    ['Standard invoice', 'Tax invoice – services', 'Statement of account', 'Quotation'].forEach((n, i) => T$('templates', { id: `tp_${t}_d${i}`, kind: 'document', name: n, version: 1 + (i % 2), updated: addDays(now, -i * 20), body: `Template ${n}` }));
    [['Friendly reminder – 3 days before due', -3, 'Hello {{contact}}, invoice {{number}} for {{amount}} is due on {{due}}.'], ['Due today', 0, 'Invoice {{number}} for {{amount}} is due today.'], ['First overdue notice – 7 days', 7, 'Invoice {{number}} for {{amount}} is now overdue. Please arrange payment.'], ['Escalation – 30 days', 30, 'Invoice {{number}} is 30 days past due. Please contact us.']].forEach(([n, off, body], i) => T$('templates', { id: `tp_${t}_r${i}`, kind: 'reminder', name: n, offset: off, version: 1, active: i < 3, body, updated: addDays(now, -i * 9), reviewed: i < 3 }));
    [['PO number', 'text', 'invoice'], ['Project code', 'text', 'invoice'], ['Account manager', 'select', 'customer']].forEach(([n, ty, ent], i) => T$('customFields', { id: `cf_${t}_${i}`, name: n, type: ty, entity: ent, required: i === 0, active: true }));
    ITEMS.forEach(([name, kind, rate, tax, unit], i) => T$('items', { id: `it_${t}_${i}`, name, kind, rate, taxPct: tax, unit, hsn: kind === 'GOODS' ? `${7300 + i * 11}` : '9983', active: true }));
    const items = db.items.filter((x) => x.tenantId === t);

    // customers + contacts
    const nCust = Math.round(CUST.length * scale + (ti ? 0 : 0));
    const custs: Row[] = [];
    for (let i = 0; i < nCust; i++) {
      const [sc, sn] = ti === 0 && i % 4 === 0 ? ['KA', 'Karnataka'] : ti === 0 && i % 5 === 0 ? ['GJ', 'Gujarat'] : [T.state, T.state === 'MH' ? 'Maharashtra' : 'Karnataka'];
      const name = ti ? CUST[(i * 3 + 5) % CUST.length] : CUST[i];
      const c = T$('customers', { id: `cu_${t}_${i}`, name, code: `C${String(i + 1).padStart(3, '0')}`, gstin: `${sc === 'MH' ? '27' : sc === 'KA' ? '29' : '24'}AAC${String.fromCharCode(65 + (i % 26))}${1000 + i * 7}K1Z${i % 9}`, state: sc, stateName: sn, city: CITY[sc] ?? 'Pune', terms: pick([15, 30, 30, 45]), creditLimit: pick([50, 100, 200, 500]) * 100000, status: i === 17 && ti === 0 ? 'on_hold' : 'active', accountManager: pick(['Rohan Iyer', 'Anita Shah']), email: `accounts@${name.split(' ')[0].toLowerCase()}.example`, billingAddress: `${10 + i}, Industrial Estate, ${CITY[sc] ?? 'Pune'}`, bankChange: false });
      custs.push(c);
      T$('contacts', { id: `ct_${t}_${i}a`, customerId: c.id, name: `${pick(FIRST)} ${pick(LAST)}`, role: 'Billing contact', email: c.email, phone: `+91 98${Math.floor(10000000 + r() * 89999999)}`, billing: true, authorisedToAccept: true, portal: true });
      T$('contacts', { id: `ct_${t}_${i}b`, customerId: c.id, name: `${pick(FIRST)} ${pick(LAST)}`, role: 'Operations', email: `ops@${name.split(' ')[0].toLowerCase()}.example`, phone: `+91 97${Math.floor(10000000 + r() * 89999999)}`, billing: false, authorisedToAccept: false, portal: false });
      T$('portalLinks', { id: `pl_${t}_${i}`, customerId: c.id, token: Math.random().toString(36).slice(2, 12), active: i !== 11, created: addDays(now, -50) });
    }
    const supps: Row[] = [];
    for (let i = 0; i < Math.round(SUPP.length * (ti ? 0.5 : 1)); i++) supps.push(T$('suppliers', { id: `su_${t}_${i}`, name: SUPP[i], gstin: `27AAS${String.fromCharCode(65 + i)}${2000 + i * 13}M1Z${i}`, terms: pick([15, 30, 45]), bank: `HDFC •••• ${1000 + i * 37}`, bankChangePending: ti === 0 && i === 3, status: 'active', email: `ap@${SUPP[i].split(' ')[0].toLowerCase()}.example` }));

    // invoices
    const counters: Record<string, number> = { INV: 0, QT: 0, RCT: 0, CN: 0, DN: 0 };
    const nextNo = (p: string, issue: string) => { counters[p]++; return docNumber(`${T.prefix}-${p}`, fiscalYear(issue), counters[p]); };
    const mkLines = (): Line[] => Array.from({ length: 1 + Math.floor(r() * 3) }, () => { const it = pick(items); return { desc: it.name, qty: 1 + Math.floor(r() * 9), rate: Math.round(it.rate * (0.9 + r() * 0.3) / 100) * 100, discountPct: r() < 0.2 ? 5 : 0, taxPct: it.taxPct, itemId: it.id, unit: it.unit }; });
    const invs: Row[] = [];
    const nInv = Math.round(70 * scale);
    for (let i = 0; i < nInv; i++) {
      const c = pick(custs); const lines = mkLines(); const issue = addDays(now, -Math.floor(r() * 180) - 1);
      const intra = c.state === T.state; const tot = calcDoc(lines, { intraState: intra });
      let status = 'issued'; if (i % 17 === 5) status = 'draft'; else if (i % 23 === 7) status = 'pending_approval'; else if (i % 31 === 11) status = 'void';
      const number = status === 'draft' || status === 'pending_approval' ? '' : nextNo('INV', issue);
      const inv = T$('invoices', { id: `in_${t}_${i}`, number, customerId: c.id, customer: c.name, branchId: `br_${t}_${1 + (i % 2)}`, status, issueDate: status === 'draft' || status === 'pending_approval' ? now : issue, dueDate: addDays(issue, c.terms), terms: c.terms, lines, intraState: intra, docDiscountPct: 0, totals: tot, total: tot.total, source: i % 6 === 0 ? 'quote' : i % 9 === 0 ? 'schedule' : 'manual', delivery: status === 'issued' ? pick(['delivered', 'delivered', 'delivered', 'opened', 'failed']) : status === 'void' ? 'none' : 'not_sent', notes: '', custom: { 'PO number': `PO-${4000 + i}` }, history: [{ at: issue + 'T09:00:00Z', by: 'Anita Shah', what: 'Created draft' }, ...(number ? [{ at: issue + 'T10:00:00Z', by: 'Rohan Iyer', what: `Issued as ${number}` }] : [])] });
      invs.push(inv);
    }
    // receipts + allocations
    const paying = invs.filter((x) => x.status === 'issued');
    paying.forEach((inv, i) => {
      const roll = (i * 7 + 3) % 10; if (roll < 3) return; // ~30% untouched
      const full = roll >= 6; const amt = full ? inv.total : Math.round((inv.total * (0.3 + r() * 0.4)) / 100) * 100;
      const pdate = addDays(inv.issueDate, 5 + Math.floor(r() * 30)); if (pdate > now) return;
      const mode = pick(['bank_transfer', 'upi', 'cheque', 'card', 'bank_transfer']);
      const rc = T$('receipts', { id: `rc_${t}_${i}`, number: nextNo('RCT', pdate), customerId: inv.customerId, customer: inv.customer, date: pdate, amount: amt, mode, ref: (mode === 'upi' ? 'UPI' : mode === 'cheque' ? 'CHQ' : 'UTR') + (500000 + i * 131), providerStatus: mode === 'card' ? 'captured' : 'n/a', status: 'applied', providerEventId: 'evt_' + (1000 + i), notes: '' });
      T$('allocations', { id: `al_${t}_${i}`, receiptId: rc.id, invoiceId: inv.id, amount: amt, at: pdate, by: 'Anita Shah', reversed: false });
    });
    // unapplied receipts, overpayment, a reversed receipt
    for (let k = 0; k < 3; k++) { const c = custs[k * 3 % custs.length]; T$('receipts', { id: `rc_${t}_u${k}`, number: nextNo('RCT', addDays(now, -k * 4 - 1)), customerId: c.id, customer: c.name, date: addDays(now, -k * 4 - 1), amount: [4500000, 1275000, 860000][k], mode: 'bank_transfer', ref: 'UTR' + (900100 + k * 17), providerStatus: 'n/a', status: 'unapplied', providerEventId: 'evt_u' + k, notes: k === 1 ? 'Customer paid more than invoice – confirm intent' : '' }); }
    // a split receipt across two invoices of one customer
    const sc = custs[1]; const two = invs.filter((x) => x.customerId === sc.id && x.status === 'issued' && !db.allocations.some((a) => a.invoiceId === x.id)).slice(0, 2);
    if (two.length === 2) { const amt = two[0].total + Math.round(two[1].total / 2 / 100) * 100; const rc = T$('receipts', { id: `rc_${t}_split`, number: nextNo('RCT', addDays(now, -9)), customerId: sc.id, customer: sc.name, date: addDays(now, -9), amount: amt, mode: 'bank_transfer', ref: 'UTR777001', providerStatus: 'n/a', status: 'applied', providerEventId: 'evt_split', notes: 'Split across two invoices' }); T$('allocations', { id: `al_${t}_s1`, receiptId: rc.id, invoiceId: two[0].id, amount: two[0].total, at: addDays(now, -9), by: 'Anita Shah', reversed: false }); T$('allocations', { id: `al_${t}_s2`, receiptId: rc.id, invoiceId: two[1].id, amount: Math.round(two[1].total / 2 / 100) * 100, at: addDays(now, -9), by: 'Anita Shah', reversed: false }); }
    // credits, disputes
    const openInv = invs.filter((x) => x.status === 'issued' && !db.allocations.some((a) => a.invoiceId === x.id));
    openInv.slice(0, 5).forEach((inv, k) => { const kind = k === 4 ? 'debit' : 'credit'; const amt = Math.round(inv.total * [0.1, 0.05, 0.2, 0.15, 0.03][k] / 100) * 100; T$('credits', { id: `cr_${t}_${k}`, number: nextNo(kind === 'credit' ? 'CN' : 'DN', now), kind, invoiceId: inv.id, invoiceNumber: inv.number, customerId: inv.customerId, customer: inv.customer, amount: amt, reason: ['Short shipment', 'Rate correction', 'Damaged goods', 'Volume rebate', 'Late delivery charge'][k], status: ['approved', 'approved', 'pending', 'approved', 'pending'][k], requestedBy: 'Anita Shah', approvedBy: k === 2 || k === 4 ? '' : 'Rohan Iyer', date: addDays(now, -k * 3 - 2), period: fiscalYear(now) }); });
    openInv.slice(5, 9).forEach((inv, k) => { const d = T$('disputes', { id: `ds_${t}_${k}`, invoiceId: inv.id, invoiceNumber: inv.number, customerId: inv.customerId, customer: inv.customer, amount: Math.round(inv.total * 0.25 / 100) * 100, reason: ['Quantity mismatch', 'Price not as quoted', 'Service not delivered', 'Duplicate billing'][k], status: ['open', 'under_review', 'resolved', 'rejected'][k], opened: addDays(now, -k * 6 - 3), owner: 'Rohan Iyer', pausesReminders: true, outcome: k === 2 ? 'Credit note issued' : k === 3 ? 'Dispute rejected – invoice stands' : '' }); T$('disputeEvents', { id: `de_${t}_${k}`, disputeId: d.id, at: d.opened + 'T10:00:00Z', by: d.customer, what: 'Dispute raised via portal', evidence: k % 2 === 0 ? 'delivery_challan.pdf' : '' }); });

    // quotes
    const nq = Math.round(18 * scale);
    for (let i = 0; i < nq; i++) {
      const c = pick(custs); const lines = mkLines(); const issue = addDays(now, -Math.floor(r() * 60)); const tot = calcDoc(lines, { intraState: c.state === T.state, docDiscountPct: i % 5 === 0 ? 8 : 0 });
      const status = ['draft', 'pending_approval', 'sent', 'sent', 'accepted', 'accepted', 'declined', 'expired', 'converted'][i % 9];
      T$('quotes', { id: `qt_${t}_${i}`, number: status === 'draft' ? '' : nextNo('QT', issue), customerId: c.id, customer: c.name, status, date: issue, validUntil: status === 'expired' ? addDays(now, -5) : addDays(now, 14 + (i % 3) * 7), lines, intraState: c.state === T.state, docDiscountPct: i % 5 === 0 ? 8 : 0, totals: tot, total: tot.total, terms: 'Payment within agreed terms. Prices valid until the date shown.', revision: 1 + (i % 3 === 0 ? 1 : 0), revisions: [{ rev: 1, at: issue, by: 'Anita Shah', note: 'First version', total: tot.total }, ...(i % 3 === 0 ? [{ rev: 2, at: addDays(issue, 2), by: 'Rohan Iyer', note: 'Revised quantities', total: tot.total }] : [])], acceptedBy: status === 'accepted' || status === 'converted' ? `${c.name} – billing contact` : '', acceptedRev: status === 'accepted' || status === 'converted' ? 1 : 0, approval: i % 5 === 0 ? 'required' : 'not_required', convertedTo: '' });
    }
    // schedules
    for (let i = 0; i < Math.round(6 * scale + 1); i++) { const c = custs[(i * 4 + 2) % custs.length]; const lines: Line[] = [{ desc: ['Annual maintenance', 'Audit support retainer', 'Consulting – hourly'][i % 3], qty: 1, rate: [200000, 1800000, 250000][i % 3] * (1 + (i % 2)), taxPct: 18 }]; const tot = calcDoc(lines, { intraState: c.state === T.state }); T$('schedules', { id: `sc_${t}_${i}`, name: `${c.name} – ${lines[0].desc}`, customerId: c.id, customer: c.name, frequency: ['monthly', 'monthly', 'quarterly', 'yearly', 'monthly', 'weekly', 'monthly'][i], start: addDays(now, -120), end: i === 3 ? addDays(now, 300) : '', nextRun: addDays(now, 3 + i * 4), status: i === 4 ? 'paused' : 'active', lines, total: tot.total, intraState: c.state === T.state, autoCollect: false, runs: [{ period: addMonths(now, -1).slice(0, 7), invoice: '' , at: addDays(now, -28) }], lastError: i === 5 ? 'Customer on hold – run skipped' : '' }); }
    // expenses + bills
    ['Fuel – delivery van', 'Client lunch', 'Courier charges', 'Software subscription', 'Travel – Pune', 'Office supplies', 'Printing', 'Mobile recharge'].forEach((n, i) => { for (let j = 0; j < Math.max(1, Math.round(2 * scale)); j++) T$('expenses', { id: `ex_${t}_${i}_${j}`, claimant: pick(['Anita Shah', 'Rohan Iyer', 'Meera Kulkarni']), title: n, category: pick(['Travel', 'Office', 'Logistics', 'Software', 'Meals']), amount: 50000 + Math.floor(r() * 400000), date: addDays(now, -Math.floor(r() * 50)), receipt: i % 4 === 3 ? '' : `receipt_${i}${j}.jpg`, status: ['submitted', 'approved', 'approved', 'rejected', 'reimbursed'][(i + j) % 5], reason: (i + j) % 5 === 3 ? 'Missing GST invoice' : '' }); });
    supps.forEach((s, i) => { for (let j = 0; j < Math.max(1, Math.round(2 * (ti ? 1 : 1))); j++) { const amt = 400000 + Math.floor(r() * 2500000); const issue = addDays(now, -Math.floor(r() * 60) - 1); const b = T$('bills', { id: `bl_${t}_${i}_${j}`, supplierId: s.id, supplier: s.name, ref: `${s.name.slice(0, 3).toUpperCase()}-${1000 + i * 9 + j}`, date: issue, dueDate: addDays(issue, s.terms), amount: amt, category: pick(['Raw materials', 'Freight', 'Utilities', 'Rent', 'Services']), status: ['approved', 'approved', 'pending_review', 'approved', 'paid'][(i + j) % 5], attachment: `bill_${i}${j}.pdf`, notes: '' }); if (b.status === 'paid') T$('supplierPayments', { id: `sp_${t}_${i}_${j}`, billId: b.id, supplierId: s.id, supplier: s.name, amount: amt, date: addDays(issue, 10), mode: 'bank_transfer', ref: 'PAY' + (3000 + i) }); else if ((i + j) % 4 === 0 && b.status === 'approved') T$('supplierPayments', { id: `sp_${t}_${i}_${j}`, billId: b.id, supplierId: s.id, supplier: s.name, amount: Math.round(amt / 3 / 100) * 100, date: addDays(issue, 12), mode: 'bank_transfer', ref: 'PAY' + (3200 + i) }); } });
    // bank transactions
    const recs = db.receipts.filter((x) => x.tenantId === t);
    recs.slice(0, 18).forEach((rc, i) => T$('bankTx', { id: `bt_${t}_${i}`, date: rc.date, desc: `NEFT ${rc.customer}`, ref: rc.ref, amount: rc.amount, direction: 'in', source: i % 3 === 0 ? 'provider' : 'csv', status: i % 4 === 3 ? 'unmatched' : 'matched', matchedTo: i % 4 === 3 ? '' : rc.id, approved: i % 2 === 0 && i % 4 !== 3 }));
    T$('bankTx', { id: `bt_${t}_x1`, date: addDays(now, -6), desc: 'NEFT Unknown remitter', ref: 'UTR999111', amount: 3250000, direction: 'in', source: 'csv', status: 'unmatched', matchedTo: '', approved: false });
    T$('bankTx', { id: `bt_${t}_x2`, date: addDays(now, -3), desc: 'NEFT Aarav Textiles (duplicate import)', ref: recs[0]?.ref ?? 'UTR1', amount: recs[0]?.amount ?? 1, direction: 'in', source: 'csv', status: 'duplicate', matchedTo: '', approved: false });
    T$('bankTx', { id: `bt_${t}_x3`, date: addDays(now, -2), desc: 'NEFT Cobalt Logistics short pay', ref: 'UTR888222', amount: 1990000, direction: 'in', source: 'csv', status: 'discrepancy', matchedTo: '', approved: false });
    db.supplierPayments.filter((x) => x.tenantId === t).slice(0, 4).forEach((sp, i) => T$('bankTx', { id: `bt_${t}_o${i}`, date: sp.date, desc: `Payment ${sp.supplier}`, ref: sp.ref, amount: sp.amount, direction: 'out', source: 'csv', status: 'matched', matchedTo: sp.id, approved: false }));
    T$('exports', { id: `xp_${t}_1`, kind: 'Accounting CSV', period: 'Last month', rows: 148, status: 'succeeded', at: addDays(now, -30) + 'T11:00:00Z', by: 'Rohan Iyer' });
    T$('exports', { id: `xp_${t}_2`, kind: 'Accounting CSV', period: 'This month', rows: 0, status: 'failed', at: addDays(now, -1) + 'T11:00:00Z', by: 'Rohan Iyer', error: '3 receipts are not reconciled' });
    // collections
    custs.slice(0, 6).forEach((c, i) => { T$('contactLog', { id: `cl_${t}_${i}`, customerId: c.id, customer: c.name, at: addDays(now, -i * 2 - 1) + 'T11:00:00Z', channel: pick(['call', 'email', 'whatsapp', 'visit']), by: 'Anita Shah', note: ['Spoke to accounts; payment next week', 'Left voicemail', 'Emailed statement', 'Visited site; cheque promised', 'Customer disputes quantity', 'No response'][i] }); T$('reminderLog', { id: `rl_${t}_${i}`, customerId: c.id, customer: c.name, template: 'First overdue notice – 7 days', channel: 'email', at: addDays(now, -i * 3 - 2) + 'T08:00:00Z', status: i === 4 ? 'failed' : 'delivered', error: i === 4 ? 'Mailbox full' : '' }); });
    custs.slice(0, 5).forEach((c, i) => T$('promises', { id: `pr_${t}_${i}`, customerId: c.id, customer: c.name, amount: [2500000, 1200000, 800000, 3400000, 950000][i], promisedOn: addDays(now, [3, -2, 6, -5, 1][i]), madeOn: addDays(now, -8 + i), status: i === 1 || i === 3 ? 'missed' : i === 4 ? 'kept' : 'open', owner: 'Anita Shah', escalated: i === 3 }));
    // imports
    T$('imports', { id: `im_${t}_1`, kind: 'Customers', file: 'customers_march.csv', rows: 42, errors: 3, status: 'completed_with_errors', at: addDays(now, -60), by: 'Meera Kulkarni' });
    T$('importRows', { id: `ir_${t}_1`, importId: `im_${t}_1`, row: 7, field: 'GSTIN', error: 'Invalid GSTIN length', value: '27AABC12' });
    T$('importRows', { id: `ir_${t}_2`, importId: `im_${t}_1`, row: 19, field: 'Terms', error: 'Must be a number of days', value: 'thirty' });
    T$('importRows', { id: `ir_${t}_3`, importId: `im_${t}_1`, row: 31, field: 'Name', error: 'Possible duplicate of Bhatia Steel Works', value: 'Bhatia Steel Wrks' });
    // roles
    ([['owner', PERMISSIONS], ['manager', ['view', 'create', 'edit', 'approve', 'assign', 'export']], ['staff', ['view', 'create', 'edit']], ['customer', ['view']]] as const).forEach(([n, perms]) => T$('roleDefs', { id: `rd_${t}_${n}`, name: n, permissions: [...perms], system: true }));
    // support, integrations, api
    T$('supportAccess', { id: `sa_${t}_1`, requestedBy: 'Sara Thomas (Ledgerline support)', reason: 'Investigate failed statement import', scope: 'Imports only', requested: addDays(now, -1), expires: addDays(now, 1), status: ti === 0 ? 'pending' : 'denied' });
    T$('integrations', { id: `ig_${t}_1`, name: 'Payment provider (Razorpay)', direction: 'inbound', schedule: 'Real time webhook', sourceOfTruth: 'Provider', owner: 'Rohan Iyer', status: 'connected', lastSync: addDays(now, 0) + 'T07:00:00Z', failures: 0 });
    T$('integrations', { id: `ig_${t}_2`, name: 'Transactional email (SMTP)', direction: 'outbound', schedule: 'Real time', sourceOfTruth: 'Ledgerline', owner: 'Rohan Iyer', status: 'connected', lastSync: addDays(now, 0) + 'T07:30:00Z', failures: 1 });
    T$('integrations', { id: `ig_${t}_3`, name: 'Accounting CSV export', direction: 'outbound', schedule: 'Monthly', sourceOfTruth: 'Ledgerline', owner: 'Meera Kulkarni', status: 'needs_attention', lastSync: addDays(now, -1) + 'T11:00:00Z', failures: 1 });
    T$('apiKeys', { id: `ak_${t}_1`, name: 'Reporting read-only', prefix: 'll_live_8f3a', scope: 'read', created: addDays(now, -90), lastUsed: addDays(now, -1), active: true });
    for (let i = 0; i < 6; i++) T$('webhookLogs', { id: `wh_${t}_${i}`, event: ['invoice.issued', 'receipt.created', 'payment.captured', 'invoice.overdue', 'receipt.created', 'payment.failed'][i], endpoint: 'https://hooks.example.com/ledgerline', status: i === 5 ? 500 : 200, attempts: i === 5 ? 3 : 1, at: addDays(now, -i) + 'T09:00:00Z', key: 'evt_' + (7000 + i) });
    ['Short shipment', 'Rate correction', 'Damaged goods', 'Volume rebate', 'Late delivery charge', 'Duplicate billing', 'Goodwill'].forEach((n, i) => T$('reasonCodes', { id: `rs_${t}_${i}`, name: n, kind: i === 4 ? 'debit' : 'credit', needsEvidence: i === 2 || i === 0, active: true }));
    ['Travel', 'Office', 'Logistics', 'Software', 'Meals', 'Utilities', 'Professional fees'].forEach((n, i) => T$('expenseCategories', { id: `ec_${t}_${i}`, name: n, ledgerCode: 5000 + i * 10, receiptRequired: i !== 4, active: true }));
    custs.slice(0, 8).forEach((c, i) => T$('paymentAttempts', { id: `pa_${t}_${i}`, customerId: c.id, customer: c.name, amount: 150000 + i * 237000, mode: ['card', 'upi', 'card', 'upi'][i % 4], status: ['succeeded', 'failed', 'succeeded', 'disputed', 'failed', 'succeeded', 'succeeded', 'failed'][i], reason: ['', 'Insufficient funds', '', 'Chargeback: goods not received', 'Card declined by issuer', '', '', 'UPI timeout'][i], at: addDays(now, -i * 2) + 'T10:00:00Z', ref: 'pay_' + (800000 + i * 31) }));
    // subscription
    const planId = 'growth';
    T$('subscriptions', { id: `sub_${t}`, planId, planVersion: 3, cycle: ti ? 'yearly' : 'monthly', status: 'active', renewsOn: addDays(now, 12), started: addDays(now, -240), usersUsed: db.members.filter((m) => m.tenantId === t && m.status !== 'suspended').length, branchesUsed: 2, entitiesUsed: 1, invoicesThisMonth: Math.min(180, db.invoices.filter((x) => x.tenantId === t).length), storageMb: 640, graceDays: 7, renewalFailure: false, cancelAt: '' });
    for (let i = 0; i < 4; i++) T$('subInvoices', { id: `si_${t}_${i}`, number: `LL/${fiscalYear(now)}/${900 + i + ti * 50}`, date: addMonths(now, -i), amount: 299900, status: i === 0 && ti === 0 ? 'upcoming' : 'paid', plan: 'Growth v3' });
    T$('paymentMethods', { id: `pm_${t}_1`, kind: 'Card', label: 'Visa •••• 4242', expires: '08/2028', primary: true, mandate: false });
    T$('paymentMethods', { id: `pm_${t}_2`, kind: 'UPI AutoPay', label: 'owner@okbank', expires: '', primary: false, mandate: true });
    T$('notifications', { id: `nt_${t}_1`, at: addDays(now, 0) + 'T08:00:00Z', text: 'Receipt UTR999111 is unmatched', link: '/app/reconciliation/unmatched', read: false });
    T$('notifications', { id: `nt_${t}_2`, at: addDays(now, -1) + 'T08:00:00Z', text: 'Promise to pay missed by Bhatia Steel Works', link: '/app/collections/missed', read: false });
    T$('notifications', { id: `nt_${t}_3`, at: addDays(now, -2) + 'T08:00:00Z', text: 'Quotation awaiting your approval', link: '/app/quotes/approvals', read: true });
    T$('messages', { id: `ms_${t}_1`, customerId: custs[0].id, from: 'customer', at: addDays(now, -2) + 'T09:00:00Z', text: 'Please resend the statement for last quarter.', status: 'open' });
    T$('sessions', { id: `se_${t}_1`, device: 'Chrome on Windows', ip: '203.0.113.24', city: T.city, started: addDays(now, 0) + 'T08:00:00Z', current: true });
    T$('sessions', { id: `se_${t}_2`, device: 'Safari on iPhone', ip: '198.51.100.7', city: T.city, started: addDays(now, -3) + 'T19:20:00Z', current: false });
    // audit
    ['Role permissions changed for staff', 'Invoice issued', 'Credit note approved', 'Period Q1 locked', 'Customer bank details change requested', 'Reminder template activated', 'User suspended'].forEach((a, i) => T$('audit', { id: `au_${t}_${i}`, at: addDays(now, -i * 3) + 'T1' + (i % 10) + ':00:00Z', actor: ['Meera Kulkarni', 'Rohan Iyer', 'Anita Shah'][i % 3], action: a, entity: 'system', sensitive: i % 2 === 0 }));
    // numbering sync
    Object.entries(counters).forEach(([p, n]) => { const row = db.numbering.find((x) => x.id === `nm_${t}_${p}`); if (row) row.nextSeq = n + 1; });
  });
  return db;
}

export const DEFAULT_SETTINGS = (tid: string) => {
  const T = tenantMeta(tid);
  return { tenantId: tid, business: { tradeName: T.short, legalName: T.name, email: `accounts@${T.short.toLowerCase()}.example`, phone: '+91 22 4000 1100', website: `https://${T.short.toLowerCase()}.example`, industry: tid === 't1' ? 'Distribution' : 'Professional services' },
    billing: { gstin: T.gstin, address: `14 Business Park, ${T.city}`, bankName: 'HDFC Bank', accountNo: '50200012345678', ifsc: 'HDFC0000123', upi: `${T.short.toLowerCase()}@hdfcbank`, invoiceNotes: 'Payment by NEFT/UPI. Interest at 18% p.a. on overdue amounts.' },
    branding: { accent: '#244B78', logoText: T.short, footer: 'Thank you for your business.', showBank: true },
    service: { defaultTerms: 30, defaultTax: 18, rounding: 'rupee', reminderAuto: true, discountApprovalPct: 10, quoteApprovalValue: 50000000, invoiceApprovalValue: 100000000, overdueGraceDays: 0, disputePausesReminders: true },
    setup: { checklist: { business: true, billing: true, plan: true, branches: true, branding: true, team: true, import: false, review: false, activate: false }, sampleDataLoaded: true, activated: true },
    notify: { email: true, sms: false, inApp: true, digest: 'daily', events: { overdue: true, payment: true, approvals: true, disputes: true, reconciliation: false } },
    retention: { attachmentsYears: 8, auditYears: 8, invoiceAccessDays: 90, exportFormat: 'csv', purgeDrafts: 90 },
    closure: { exportRequested: false, closureRequested: false } };
};
