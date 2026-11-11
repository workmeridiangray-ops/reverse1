import { describe, it, expect } from 'vitest';
import { diffRows, planOps, toMemberRow, fromMemberRow, publicProfile, stateFromGstin } from './remote';

const base = (extra: Record<string, any[]> = {}) => ({ db: { invoices: [], members: [], contacts: [], portalLinks: [], audit: [], plans: [], platformStaff: [], supportAccess: [], ...extra } as any, settings: {} as any });
describe('diffRows', () => {
  it('finds adds, edits and removals, ignoring untouched rows', () => {
    const a = { id: 'a', n: 1 }, b = { id: 'b', n: 2 };
    const d = diffRows([a, b], [{ ...a }, { id: 'b', n: 3 }, { id: 'c', n: 4 }]);
    expect(d.upserts.map((r) => r.id)).toEqual(['b', 'c']); expect(d.deletes).toEqual([]);
    expect(diffRows([a, b], [a]).deletes).toEqual(['b']);
    expect(diffRows([a], [a])).toEqual({ upserts: [], deletes: [] });
  });
});
describe('planOps', () => {
  const ctx = { tenantId: 't1', platform: false };
  it('sends only this business’s rows and never another tenant’s', () => {
    const next = base({ invoices: [{ id: 'i1', tenantId: 't1' }, { id: 'i2', tenantId: 'tX' }] });
    const ops = planOps(base(), next, ctx);
    expect(ops).toEqual([{ kind: 'records', upsert: [{ tenant_id: 't1', collection: 'invoices', id: 'i1', data: { id: 'i1', tenantId: 't1' } }] }]);
  });
  it('maps deletions', () => {
    const prev = base({ invoices: [{ id: 'i1', tenantId: 't1' }] });
    expect(planOps(prev, base(), ctx)).toEqual([{ kind: 'records_delete', tenant_id: 't1', collection: 'invoices', ids: ['i1'] }]);
  });
  it('never sends passwords: members go to the members table with only safe columns', () => {
    const m = { id: 'm1', tenantId: 't1', email: ' a@x.test ', name: 'A', role: 'staff', status: 'invited', branch: 'b1', title: 'T', mfa: false, password: 'secret', lastSeen: '' };
    const ops = planOps(base(), base({ members: [m] }), ctx);
    expect(ops).toHaveLength(1); const row = (ops[0] as any).upsert[0];
    expect(row).not.toHaveProperty('password'); expect(row.email).toBe('a@x.test'); expect(row.tenant_id).toBe('t1');
  });
  it('keeps portal access in step with contacts and revocation', () => {
    const c = { id: 'c1', tenantId: 't1', customerId: 'cu1', email: 'Bill@Acme.test', portal: true };
    expect(planOps(base(), base({ contacts: [c] }), ctx).map((o) => o.kind)).toEqual(['records', 'portal_add']);
    expect(planOps(base({ contacts: [c] }), base({ contacts: [{ ...c, portal: false }] }), ctx).map((o) => o.kind)).toEqual(['records', 'portal_remove']);
    const link = { id: 'pl', tenantId: 't1', customerId: 'cu1', active: true };
    const ops = planOps(base({ portalLinks: [link] }), base({ portalLinks: [{ ...link, active: false }] }), ctx);
    expect(ops.find((o) => o.kind === 'portal_active')).toEqual({ kind: 'portal_active', tenant_id: 't1', customer_id: 'cu1', active: false });
  });
  it('saves settings together with the customer-visible public profile only', () => {
    const s = { service: { invoiceApprovalValue: 1 }, business: { legalName: 'X' }, billing: { gstin: 'G' }, branding: { logoText: 'X' }, notify: {} };
    const ops = planOps(base(), { db: base().db, settings: { t1: s } }, ctx);
    const rows = (ops[0] as any).upsert; expect(rows.map((r: any) => r.collection)).toEqual(['_settings', '_public']);
    expect(rows[1].data).toEqual(publicProfile(s)); expect(JSON.stringify(rows[1].data)).not.toContain('invoiceApprovalValue');
  });
  it('platform staff write platform records only, and support access goes through the RPC', () => {
    const pctx = { tenantId: null, platform: true };
    expect(planOps(base(), base({ plans: [{ id: 'p', n: 1 }], invoices: [{ id: 'i', tenantId: 't1' }] }), pctx)).toEqual([{ kind: 'platform', upsert: [{ collection: 'plans', id: 'p', data: { id: 'p', n: 1 } }] }]);
    const sa = { id: 's', tenantId: 't1', reason: 'why', scope: 'x', expires: '2026-12-31', status: 'pending' };
    expect(planOps(base(), base({ supportAccess: [sa] }), { tenantId: 't1', platform: true })).toEqual([{ kind: 'rpc', fn: 'request_support_access', args: { p_tenant: 't1', p_reason: 'why', p_scope: 'x', p_expires: '2026-12-31' } }]);
  });
  it('platform rows from a business session are not sent', () => {
    expect(planOps(base(), base({ plans: [{ id: 'p' }] }), ctx)).toEqual([]);
  });
  it('creating platform staff is reported as unsupported rather than silently dropped', () => {
    expect(planOps(base(), base({ platformStaff: [{ id: 'x', email: 'e' }] }), { tenantId: null, platform: true })[0].kind).toBe('unsupported');
  });
});
describe('mappers', () => {
  it('round-trips members and derives state from GSTIN', () => {
    const m = { id: 'm', tenantId: 't', email: 'e@x.test', name: 'N', role: 'owner', status: 'active', branch: 'b', title: 'T', mfa: true, suspendReason: '' };
    expect(fromMemberRow(toMemberRow(m) as any)).toMatchObject({ id: 'm', tenantId: 't', role: 'owner', branch: 'b', mfa: true });
    expect(stateFromGstin('29AAAA')).toBe('KA'); expect(stateFromGstin(undefined)).toBe('MH');
  });
});
