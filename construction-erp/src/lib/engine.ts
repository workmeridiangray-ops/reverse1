import 'server-only';
import { type Q, AppError, many, one } from './db';
import type { E, F } from './entities';
import { parseMoney, parseQty, formatINR } from './rules/money';
import { toNumeric } from './domain/common';

export const PAGE = 25;

/** Parse one submitted field into a database value. Throws AppError with a human message. */
export function parseField(f: F, fd: FormData): unknown {
  const raw = String(fd.get(f.n) ?? '').trim();
  if (f.t === 'bool') return fd.get(f.n) === 'on';
  if (raw === '') { if (f.req) throw new AppError(`${f.l} is required.`, 'required'); return null; }
  try {
    switch (f.t) {
      case 'money': return parseMoney(raw).toString();
      case 'qty': return toNumeric(parseQty(raw));
      case 'int': { const n = Number(raw); if (!Number.isInteger(n) || Math.abs(n) > 1e9) throw 0; return n; }
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(Date.parse(raw))) throw 0; return raw;
      case 'email': if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) throw 0; return raw.toLowerCase();
      case 'select': if (f.opts && !f.opts.some(o => o[0] === raw)) throw 0; return raw;
      case 'ref': if (!/^[0-9a-f-]{36}$/.test(raw)) throw 0; return raw;
      default: return raw.slice(0, 5000);
    }
  } catch { throw new AppError(`${f.l} is not valid${f.t === 'money' ? ' (use up to 2 decimals)' : f.t === 'qty' ? ' (up to 3 decimals)' : ''}.`, 'invalid'); }
}

export function display(f: F, v: any, refLabel?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (f.t) {
    case 'money': return formatINR(v);
    case 'bool': return v ? 'Yes' : 'No';
    case 'ref': return refLabel ?? '—';
    case 'date': return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    case 'select': return String(v).replace(/_/g, ' ');
    default: return String(v);
  }
}

const refSql = (f: F) => f.ref!.table === 'users_in_org'
  ? `(select name from users where id = t.${f.n})`
  : `(select ${f.ref!.label} from ${f.ref!.table} x where x.id = t.${f.n})`;

export async function refOptions(q: Q, f: F, projectId: string | null): Promise<{ id: string; label: string }[]> {
  const r = f.ref!;
  if (r.table === 'users_in_org') return many(q, `select u.id, u.name label from users u join memberships m on m.user_id = u.id and m.status='active' and m.role not in ('client','consultant','contractor') where m.org_id = app_org() order by u.name`);
  const scoped = !r.org && r.table !== 'projects' && projectId;
  return many(q, `select id, ${r.label} as label from ${r.table} x where true ${scoped ? 'and project_id = $1' : ''} ${r.where ? `and ${r.where}` : ''} order by 2 limit 500`, scoped ? [projectId] : []);
}

export interface ListParams { q?: string; status?: string; sort?: string; dir?: string; page?: number }
export async function listRows(q: Q, e: E, projectId: string | null, p: ListParams) {
  const refs = e.fields.filter(f => f.t === 'ref');
  const where: string[] = []; const params: unknown[] = [];
  if (e.scoped) { params.push(projectId); where.push(`t.project_id = $${params.length}`); }
  if (p.q) { params.push(`%${p.q.replace(/[%_]/g, m => '\\' + m)}%`); where.push(`(${e.search.map(c => `t.${c}::text ilike $${params.length}`).join(' or ')})`); }
  if (p.status && e.status) { params.push(p.status); where.push(`t.${e.status} = $${params.length}`); }
  const sortable = new Set([...(e.sortable ?? []), ...e.fields.filter(f => f.t !== 'ref').map(f => f.n), 'created_at']);
  const base = e.order.split(' ')[0];
  const col = p.sort && sortable.has(p.sort) ? p.sort : base;
  const dir = p.dir === 'asc' ? 'asc' : p.dir === 'desc' ? 'desc' : (p.sort ? 'asc' : (e.order.endsWith('desc') ? 'desc' : 'asc'));
  const w = where.length ? `where ${where.join(' and ')}` : '';
  const total = Number((await one<any>(q, `select count(*) n from ${e.table} t ${w}`, params))!.n);
  const page = Math.max(1, p.page ?? 1);
  const rows = await many<any>(q, `select t.*${refs.map(f => `, ${refSql(f)} as ${f.n}__l`).join('')} from ${e.table} t ${w} order by t.${col} ${dir} nulls last, t.created_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`, params);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
}
export async function loadRow(q: Q, e: E, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const refs = e.fields.filter(f => f.t === 'ref');
  return one<any>(q, `select t.*${refs.map(f => `, ${refSql(f)} as ${f.n}__l`).join('')} from ${e.table} t where t.id = $1`, [id]);
}
export function toCsv(rows: Record<string, unknown>[], cols: { key: string; label: string }[]) {
  // Cells starting with = + - @ are prefixed so spreadsheets never run them as formulas.
  const cell = (v: unknown) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map(c => cell(c.label)).join(','), ...rows.map(r => cols.map(c => cell(r[c.key])).join(','))].join('\r\n');
}
