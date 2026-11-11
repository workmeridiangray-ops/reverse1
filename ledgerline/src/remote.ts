// Supabase backend. Enabled only when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time;
// otherwise the app runs as the self-contained browser demo. The database (RLS + triggers) is the authority;
// this file only moves data and surfaces the database's refusals.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DB, Row } from './data/seed';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const REMOTE = Boolean(URL && KEY);
export const sb: SupabaseClient | null = REMOTE ? createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

/** Collections that live in platform_records (never in a tenant). */
export const PLATFORM = new Set(['biz', 'plans', 'coupons', 'incidents', 'platformPayments', 'announcements', 'leads', 'tickets', 'storageStats', 'deletionFailures', 'processingFailures', 'platformRefunds', 'jobs', 'platformAudit']);
/** Handled through their own tables/RPCs rather than the generic records table. */
const SPECIAL = new Set(['members', 'platformStaff']);

export type Op =
  | { kind: 'records'; upsert: { tenant_id: string; collection: string; id: string; data: Row }[] }
  | { kind: 'records_delete'; tenant_id: string; collection: string; ids: string[] }
  | { kind: 'platform'; upsert: { collection: string; id: string; data: Row }[] }
  | { kind: 'platform_delete'; collection: string; ids: string[] }
  | { kind: 'members'; upsert: Record<string, unknown>[] }
  | { kind: 'members_delete'; tenant_id: string; ids: string[] }
  | { kind: 'portal_add'; tenant_id: string; customer_id: string; email: string }
  | { kind: 'portal_remove'; tenant_id: string; customer_id: string; email: string }
  | { kind: 'portal_active'; tenant_id: string; customer_id: string; active: boolean }
  | { kind: 'staff_active'; email: string; active: boolean }
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }
  | { kind: 'unsupported'; message: string };

export function diffRows(prev: Row[] | undefined, next: Row[] | undefined): { upserts: Row[]; deletes: string[] } {
  if (prev === next) return { upserts: [], deletes: [] };
  const before = new Map((prev ?? []).map((r) => [r.id as string, r]));
  const after = new Map((next ?? []).map((r) => [r.id as string, r]));
  const upserts: Row[] = [];
  for (const [id, r] of after) { const b = before.get(id); if (!b || (b !== r && JSON.stringify(b) !== JSON.stringify(r))) upserts.push(r); }
  const deletes = [...before.keys()].filter((id) => !after.has(id));
  return { upserts, deletes };
}
export function toMemberRow(m: Row): Record<string, unknown> {
  return { id: m.id, tenant_id: m.tenantId, email: String(m.email).trim(), name: m.name, role: m.role, status: m.status, branch_id: m.branch ?? null, title: m.title ?? null, mfa: !!m.mfa, suspend_reason: m.suspendReason ?? null };
}
export function fromMemberRow(r: Row): Row {
  return { id: r.id, tenantId: r.tenant_id, email: r.email, name: r.name, role: r.role, status: r.status, branch: r.branch_id ?? '', title: r.title ?? '', mfa: !!r.mfa, suspendReason: r.suspend_reason ?? '', lastSeen: '', userId: r.user_id ?? null };
}
const STATE_BY_GST: Record<string, string> = { '27': 'MH', '29': 'KA', '24': 'GJ', '33': 'TN', '07': 'DL', '08': 'RJ' };
export const stateFromGstin = (g?: string) => STATE_BY_GST[(g ?? '').slice(0, 2)] ?? 'MH';
/** What a customer may see about the business: printed on invoices, never private configuration. */
export const publicProfile = (s: Row) => ({ business: s.business, billing: s.billing, branding: s.branding });

export interface Ctx { tenantId: string | null; platform: boolean }
/** Turn a state change into database operations. Pure: no network. */
export function planOps(prev: { db: DB; settings: Record<string, any> }, next: { db: DB; settings: Record<string, any> }, ctx: Ctx): Op[] {
  const ops: Op[] = [];
  for (const c of Object.keys(next.db)) {
    if (prev.db[c] === next.db[c]) continue;
    const { upserts, deletes } = diffRows(prev.db[c], next.db[c]);
    if (!upserts.length && !deletes.length) continue;
    if (c === 'platformStaff') {
      if (!ctx.platform) continue;
      const old = new Map((prev.db[c] ?? []).map((r) => [r.id, r]));
      for (const r of upserts) { const o = old.get(r.id); if (o) ops.push({ kind: 'staff_active', email: r.email, active: r.status === 'active' }); else ops.push({ kind: 'unsupported', message: 'Platform staff accounts are created in the Supabase dashboard (Authentication), then added to platform_staff.' }); }
      continue;
    }
    if (PLATFORM.has(c)) {
      if (!ctx.platform) continue;
      if (c === 'platformAudit' || upserts.length) ops.push({ kind: 'platform', upsert: upserts.map((r) => ({ collection: c, id: r.id, data: r })) });
      if (deletes.length) ops.push({ kind: 'platform_delete', collection: c, ids: deletes });
      continue;
    }
    if (!ctx.tenantId) continue;
    const t = ctx.tenantId;
    if (c === 'members') {
      const mine = upserts.filter((r) => r.tenantId === t);
      if (mine.length) ops.push({ kind: 'members', upsert: mine.map(toMemberRow) });
      if (deletes.length) ops.push({ kind: 'members_delete', tenant_id: t, ids: deletes });
      continue;
    }
    if (c === 'supportAccess' && ctx.platform) {
      for (const r of upserts) if (r.status === 'pending') ops.push({ kind: 'rpc', fn: 'request_support_access', args: { p_tenant: r.tenantId, p_reason: r.reason, p_scope: r.scope, p_expires: r.expires } });
      continue;
    }
    const mine = upserts.filter((r) => r.tenantId === t);
    if (mine.length) ops.push({ kind: 'records', upsert: mine.map((r) => ({ tenant_id: t, collection: c, id: r.id, data: r })) });
    if (deletes.length) ops.push({ kind: 'records_delete', tenant_id: t, collection: c, ids: deletes });
    if (c === 'contacts') {
      const old = new Map((prev.db[c] ?? []).map((r) => [r.id, r]));
      for (const r of mine) { const o = old.get(r.id); if (r.portal && (!o || !o.portal || o.email !== r.email)) ops.push({ kind: 'portal_add', tenant_id: t, customer_id: r.customerId, email: String(r.email).toLowerCase() }); if (o && o.portal && (!r.portal || o.email !== r.email)) ops.push({ kind: 'portal_remove', tenant_id: t, customer_id: o.customerId, email: String(o.email).toLowerCase() }); }
      for (const id of deletes) { const o = old.get(id); if (o?.portal) ops.push({ kind: 'portal_remove', tenant_id: t, customer_id: o.customerId, email: String(o.email).toLowerCase() }); }
    }
    if (c === 'portalLinks') {
      const old = new Map((prev.db[c] ?? []).map((r) => [r.id, r]));
      for (const r of mine) { const o = old.get(r.id); if (o && o.active !== r.active) ops.push({ kind: 'portal_active', tenant_id: t, customer_id: r.customerId, active: !!r.active }); }
    }
  }
  const t = ctx.tenantId;
  if (t && prev.settings[t] !== next.settings[t] && next.settings[t]) {
    ops.push({ kind: 'records', upsert: [{ tenant_id: t, collection: '_settings', id: 'main', data: next.settings[t] }, { tenant_id: t, collection: '_public', id: 'main', data: publicProfile(next.settings[t]) }] });
  }
  return ops;
}

const fail = (e: { message: string } | null, what: string) => { if (e) throw new Error(e.message || `${what} failed`); };
export async function execOps(ops: Op[]): Promise<void> {
  if (!sb) return;
  for (const op of ops) {
    switch (op.kind) {
      case 'records': for (let i = 0; i < op.upsert.length; i += 200) fail((await sb.from('records').upsert(op.upsert.slice(i, i + 200), { onConflict: 'tenant_id,collection,id' })).error, 'save'); break;
      case 'records_delete': fail((await sb.from('records').delete().eq('tenant_id', op.tenant_id).eq('collection', op.collection).in('id', op.ids)).error, 'delete'); break;
      case 'platform': for (let i = 0; i < op.upsert.length; i += 200) fail((await sb.from('platform_records').upsert(op.upsert.slice(i, i + 200), { onConflict: 'collection,id' })).error, 'save'); break;
      case 'platform_delete': fail((await sb.from('platform_records').delete().eq('collection', op.collection).in('id', op.ids)).error, 'delete'); break;
      case 'members': fail((await sb.from('members').upsert(op.upsert, { onConflict: 'id' })).error, 'save member'); break;
      case 'members_delete': fail((await sb.from('members').delete().eq('tenant_id', op.tenant_id).in('id', op.ids)).error, 'remove member'); break;
      case 'portal_add': fail((await sb.from('portal_users').upsert({ tenant_id: op.tenant_id, customer_id: op.customer_id, email: op.email, active: true }, { onConflict: 'tenant_id,customer_id,email', ignoreDuplicates: true })).error, 'portal access'); break;
      case 'portal_remove': fail((await sb.from('portal_users').delete().eq('tenant_id', op.tenant_id).eq('customer_id', op.customer_id).eq('email', op.email)).error, 'portal access'); break;
      case 'portal_active': fail((await sb.from('portal_users').update({ active: op.active }).eq('tenant_id', op.tenant_id).eq('customer_id', op.customer_id)).error, 'portal access'); break;
      case 'staff_active': fail((await sb.from('platform_staff').update({ active: op.active }).eq('email', op.email)).error, 'staff'); break;
      case 'rpc': fail((await sb.rpc(op.fn, op.args)).error, op.fn); break;
      case 'unsupported': throw new Error(op.message);
    }
  }
}

export interface Access { platform: { role: string; name: string; email: string } | null; members: Row[]; portal: { tenantId: string; customerId: string; email: string }[]; tenants: Record<string, string> }
export async function fetchAccess(): Promise<Access> {
  if (!sb) throw new Error('Supabase is not configured');
  const [staff, mem, por, ten] = await Promise.all([sb.from('platform_staff').select('*'), sb.from('members').select('*').eq('status', 'active'), sb.from('portal_users').select('*').eq('active', true), sb.from('tenants').select('id,name')]);
  const uid = (await sb.auth.getUser()).data.user?.id;
  const mine = (mem.data ?? []).filter((m) => m.user_id === uid);
  return {
    platform: (staff.data ?? []).find((s) => s.user_id === uid && s.active) ? { role: (staff.data ?? []).find((s) => s.user_id === uid)!.role, name: (staff.data ?? []).find((s) => s.user_id === uid)!.name, email: (staff.data ?? []).find((s) => s.user_id === uid)!.email } : null,
    members: mine.map(fromMemberRow),
    portal: (por.data ?? []).filter((p) => p.user_id === uid).map((p) => ({ tenantId: p.tenant_id, customerId: p.customer_id, email: p.email })),
    tenants: Object.fromEntries((ten.data ?? []).map((t) => [t.id, t.name])),
  };
}
async function pageAll(table: string, build: (q: any) => any): Promise<Row[]> {
  const out: Row[] = []; const size = 1000;
  for (let from = 0; ; from += size) { const { data, error } = await build(sb!.from(table).select('*')).range(from, from + size - 1); fail(error, 'load ' + table); out.push(...(data ?? [])); if (!data || data.length < size) break; }
  return out;
}
export async function fetchTenantData(tenantId: string): Promise<{ collections: Record<string, Row[]>; members: Row[]; settings: Row | null; profile: Row | null }> {
  const [recs, mem, shared] = await Promise.all([pageAll('records', (q) => q.eq('tenant_id', tenantId).order('collection').order('id')), pageAll('members', (q) => q.eq('tenant_id', tenantId)), pageAll('platform_records', (q) => q.in('collection', ['plans', 'announcements']))]);
  const collections: Record<string, Row[]> = {}; let settings: Row | null = null; let profile: Row | null = null;
  for (const r of recs) {
    if (r.collection === '_settings') { settings = r.data; continue; }
    if (r.collection === '_public') { profile = r.data; continue; }
    (collections[r.collection] ??= []).push({ ...r.data, id: r.id, tenantId: r.tenant_id });
  }
  for (const r of shared) (collections[r.collection] ??= []).push({ ...r.data, id: r.id });
  return { collections, members: mem.map(fromMemberRow), settings, profile };
}
export async function fetchPlatformData(): Promise<{ collections: Record<string, Row[]>; staff: Row[] }> {
  const [recs, staff] = await Promise.all([pageAll('platform_records', (q) => q.order('collection').order('id')), pageAll('platform_staff', (q) => q)]);
  const collections: Record<string, Row[]> = {};
  for (const r of recs) (collections[r.collection] ??= []).push({ ...r.data, id: r.id });
  return { collections, staff: staff.map((s, i) => ({ id: 'ps' + i, name: s.name, email: s.email, role: s.role, status: s.active ? 'active' : 'inactive', mfa: true, lastSeen: '' })) };
}
