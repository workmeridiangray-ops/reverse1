import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money, date, dateTime, cap } from '../lib/format';
import { insert, useRows } from '../store';

/* ---------- icons ---------- */
const P: Record<string, string> = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16 14h2', repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3', plus: 'M12 5v14M5 12h14', check: 'M20 6L9 17l-5-5', x: 'M18 6L6 18M6 6l12 12', chev: 'M9 18l6-6-6-6', down: 'M6 9l6 6 6-6', alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', menu: 'M3 6h18M3 12h18M3 18h18', download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7', help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01', building: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01', swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16', doc: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5', filter: 'M22 3H2l8 9.5V19l4 2v-8.5z', trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', server: 'M2 3h20v7H2zM2 14h20v7H2zM6 6.5h.01M6 17.5h.01', tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
};
export function Icon({ n, size = 18, className = '' }: { n: string; size?: number; className?: string }) {
  return <svg aria-hidden="true" className={'ic ' + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={P[n] ?? P.doc} /></svg>;
}

/* ---------- toast ---------- */
type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string };
let toastSet: ((f: (t: Toast[]) => Toast[]) => void) | null = null;
export function toast(text: string, kind: Toast['kind'] = 'ok') { const id = Date.now() + Math.random(); toastSet?.((t) => [...t, { id, kind, text }]); setTimeout(() => toastSet?.((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 4000); }
export function notify(r: { ok: boolean; error?: string; message?: string }, okText?: string) { if (r.ok) toast(r.message ?? okText ?? 'Done'); else toast(r.error ?? 'Something went wrong', 'err'); return r.ok; }
export function Toasts() {
  const [list, setList] = useState<Toast[]>([]); useEffect(() => { toastSet = setList; return () => { toastSet = null; }; }, []);
  return <div className="toasts" role="status" aria-live="polite">{list.map((t) => <div key={t.id} className={'toast ' + t.kind}><Icon n={t.kind === 'err' ? 'alert' : 'check'} size={16} /><span>{t.text}</span><button className="x" aria-label="Dismiss" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}><Icon n="x" size={14} /></button></div>)}</div>;
}

/* ---------- primitives ---------- */
export function Button({ children, variant = 'secondary', icon, ...p }: { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={`btn ${variant} ${p.className ?? ''}`}>{icon && <Icon n={icon} size={16} />}{children}</button>;
}
const BADGE: Record<string, string> = { paid: 'good', applied: 'good', approved: 'good', accepted: 'good', delivered: 'good', opened: 'good', succeeded: 'good', active: 'good', matched: 'good', resolved: 'good', kept: 'good', connected: 'good', published: 'good', converted: 'good', reimbursed: 'good', captured: 'good', completed: 'good', ok: 'good', superseded: 'muted',
  overdue: 'bad', failed: 'bad', rejected: 'bad', declined: 'bad', missed: 'bad', unmatched: 'bad', void: 'bad', suspended: 'bad', past_due: 'bad', discrepancy: 'bad', denied: 'bad', reversed: 'bad', refunded: 'warn',
  disputed: 'warn', partially_paid: 'warn', pending: 'warn', pending_approval: 'warn', pending_review: 'warn', submitted: 'warn', under_review: 'warn', open: 'warn', unapplied: 'warn', paused: 'warn', trial: 'info', duplicate: 'warn', needs_attention: 'warn', on_hold: 'warn', cancelling: 'warn', expired: 'bad', retrying: 'warn', monitoring: 'warn', needs_review: 'warn', upcoming: 'info', completed_with_errors: 'warn', invited: 'info',
  issued: 'info', sent: 'info', draft: 'muted', cancelled: 'muted', not_sent: 'muted', ended: 'muted', none: 'muted', 'n/a': 'muted', normal: 'muted', low: 'muted', high: 'warn', major: 'bad', minor: 'warn' };
export function Badge({ v, label }: { v: string; label?: string }) { const k = BADGE[v] ?? 'muted'; return <span className={'badge ' + k}><i aria-hidden="true" />{label ?? cap(String(v))}</span>; }
export function PageHeader({ title, sub, actions, crumbs }: { title: string; sub?: ReactNode; actions?: ReactNode; crumbs?: [string, string?][] }) {
  return <header className="ph">{crumbs && <nav aria-label="Breadcrumb" className="crumbs">{crumbs.map(([l, to], i) => <span key={i}>{to ? <Link to={to}>{l}</Link> : <span aria-current="page">{l}</span>}{i < crumbs.length - 1 && <Icon n="chev" size={12} />}</span>)}</nav>}<div className="ph-row"><div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div><div className="ph-actions">{actions}</div></div></header>;
}
export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) { return <section className={'card ' + className}>{(title || actions) && <div className="card-h"><h2>{title}</h2><div>{actions}</div></div>}{children}</section>; }
export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'bad' | 'good' | 'warn' }) { return <div className={'kpi ' + (tone ?? '')}><div className="kpi-l">{label}</div><div className="kpi-v num">{value}</div>{note && <div className="kpi-n">{note}</div>}</div>; }
export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) { return <div className="empty"><Icon n="doc" size={28} /><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>; }
export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) { return <div className={'notice ' + kind} role={kind === 'bad' ? 'alert' : undefined}><Icon n={kind === 'good' ? 'check' : kind === 'info' ? 'help' : 'alert'} size={16} /><div>{children}</div></div>; }
export function Tabs({ tabs, active, onChange }: { tabs: [string, string][]; active: string; onChange: (k: string) => void }) { return <div role="tablist" className="tabs">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={active === k} className={active === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>; }
export function Dl({ items }: { items: [string, ReactNode][] }) { return <dl className="dl">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>; }
export const Money = ({ v, bold }: { v: number; bold?: boolean }) => <span className={'num money' + (bold ? ' b' : '')}>{money(v)}</span>;

/* ---------- modal & drawer ---------- */
export function Modal({ title, onClose, children, wide, drawer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; drawer?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab' && ref.current) { const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')]; if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } };
    document.addEventListener('keydown', onKey); return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={'modal' + (wide ? ' wide' : '') + (drawer ? ' drawer' : '')}><div className="modal-h"><h2 id={id}>{title}</h2><button className="x" aria-label="Close" onClick={onClose}><Icon n="x" /></button></div><div className="modal-b">{children}</div></div></div>;
}
/** Ask for a mandatory reason before a financial correction or rejection. */
export function ReasonDialog({ title, label = 'Reason', confirm = 'Confirm', danger, onCancel, onSubmit, extra }: { title: string; label?: string; confirm?: string; danger?: boolean; onCancel: () => void; onSubmit: (reason: string) => boolean | void; extra?: ReactNode }) {
  const [v, setV] = useState(''); const [err, setErr] = useState('');
  return <Modal title={title} onClose={onCancel}><form onSubmit={(e) => { e.preventDefault(); if (!v.trim()) return setErr('A reason is required.'); const r = onSubmit(v.trim()); if (r !== false) onCancel(); }}>{extra}<label className="fld"><span>{label} <b className="req">*</b></span><textarea value={v} onChange={(e) => { setV(e.target.value); setErr(''); }} rows={3} aria-invalid={!!err} aria-describedby="rs-err" placeholder="e.g. Customer returned damaged goods" />{err && <em id="rs-err" className="err">{err}</em>}</label><div className="modal-f"><Button onClick={onCancel}>Cancel</Button><Button type="submit" variant={danger ? 'danger' : 'primary'}>{confirm}</Button></div></form></Modal>;
}
export function ConfirmDialog({ title, text, confirm = 'Confirm', danger, onCancel, onOk }: { title: string; text: ReactNode; confirm?: string; danger?: boolean; onCancel: () => void; onOk: () => void }) { return <Modal title={title} onClose={onCancel}><p>{text}</p><div className="modal-f"><Button onClick={onCancel}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={() => { onOk(); onCancel(); }}>{confirm}</Button></div></Modal>; }

/* ---------- forms ---------- */
export interface FieldSpec { k: string; label: string; type?: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'checkbox' | 'email' | 'tel' | 'password' | 'file'; options?: [string, string][] | string[]; required?: boolean; example?: string; help?: string; min?: number; max?: number; half?: boolean; readOnly?: boolean; when?: (v: Record<string, any>) => boolean }
const optPairs = (o?: FieldSpec['options']): [string, string][] => (o ?? []).map((x) => (Array.isArray(x) ? x : [x, cap(x)]));
export function toForm(spec: FieldSpec[], init: Record<string, any>) { const o: Record<string, any> = {}; spec.forEach((f) => { const v = init[f.k]; o[f.k] = f.type === 'money' ? (v != null ? String(v / 100) : '') : v ?? (f.type === 'checkbox' ? false : ''); }); return o; }
export function fromForm(spec: FieldSpec[], vals: Record<string, any>) { const o: Record<string, any> = {}; spec.forEach((f) => { const v = vals[f.k]; o[f.k] = f.type === 'money' ? Math.round(Number(v || 0) * 100) : f.type === 'number' ? (v === '' ? 0 : Number(v)) : v; }); return o; }
export function validate(spec: FieldSpec[], vals: Record<string, any>) {
  const e: Record<string, string> = {};
  spec.forEach((f) => { if (f.when && !f.when(vals)) return; const v = vals[f.k]; const empty = v === '' || v == null || v === false; if (f.required && empty && f.type !== 'checkbox') e[f.k] = `${f.label} is required.`;
    else if (!empty && f.type === 'email' && !/^\S+@\S+\.\S+$/.test(v)) e[f.k] = 'Enter a valid email address, like name@company.com.';
    else if (!empty && (f.type === 'number' || f.type === 'money') && (Number.isNaN(Number(v)) || (f.min != null && Number(v) < f.min) || (f.max != null && Number(v) > f.max))) e[f.k] = f.min != null && f.max != null ? `Enter a value between ${f.min} and ${f.max}.` : f.min != null ? `Enter a value of ${f.min} or more.` : 'Enter a valid number.'; });
  return e;
}
export function FieldInput({ f, value, onChange, error, id }: { f: FieldSpec; value: any; onChange: (v: any) => void; error?: string; id: string }) {
  const common = { id, 'aria-invalid': !!error, 'aria-describedby': error ? id + '-e' : f.help ? id + '-h' : undefined, disabled: f.readOnly } as const;
  let input: ReactNode;
  switch (f.type) {
    case 'textarea': input = <textarea {...common} rows={3} value={value} placeholder={f.example} onChange={(e) => onChange(e.target.value)} />; break;
    case 'select': input = <select {...common} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select…</option>{optPairs(f.options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>; break;
    case 'checkbox': input = <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />; break;
    case 'file': input = <input {...common} type="file" onChange={(e) => onChange(e.target.files?.[0]?.name ?? '')} />; break;
    case 'money': input = <div className="money-in"><span aria-hidden="true">₹</span><input {...common} inputMode="decimal" type="number" step="0.01" min={f.min ?? 0} value={value} placeholder={f.example ?? '0.00'} onChange={(e) => onChange(e.target.value)} /></div>; break;
    default: input = <input {...common} type={f.type ?? 'text'} min={f.min} max={f.max} value={value} placeholder={f.example} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === 'checkbox') return <div className={'fld chk' + (f.half ? ' half' : '')}><label htmlFor={id}>{input}<span>{f.label}</span></label>{f.help && <small id={id + '-h'}>{f.help}</small>}</div>;
  return <div className={'fld' + (f.half ? ' half' : '')}><label htmlFor={id}><span>{f.label}{f.required && <b className="req" aria-hidden="true"> *</b>}</span></label>{input}{f.help && !error && <small id={id + '-h'}>{f.help}</small>}{error && <em id={id + '-e'} className="err">{error}</em>}</div>;
}
export function FormView({ spec, init = {}, submit = 'Save', onSubmit, onCancel, draftKey, busyText }: { spec: FieldSpec[]; init?: Record<string, any>; submit?: string; onSubmit: (v: Record<string, any>) => { ok: boolean; error?: string; message?: string } | void; onCancel?: () => void; draftKey?: string; busyText?: string }) {
  const uidp = useId();
  const [vals, setVals] = useState<Record<string, any>>(() => { const base = toForm(spec, init); if (draftKey) { try { const d = sessionStorage.getItem('draft:' + draftKey); if (d) return { ...base, ...JSON.parse(d) }; } catch { /* no draft */ } } return base; });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [top, setTop] = useState('');
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);
  useEffect(() => { if (draftKey && dirty) try { sessionStorage.setItem('draft:' + draftKey, JSON.stringify(vals)); } catch { /* storage unavailable */ } }, [vals, dirty, draftKey]);
  return <form noValidate className="form" onSubmit={(e) => {
    e.preventDefault(); const er = validate(spec, vals); setErrs(er); setTop('');
    if (Object.keys(er).length) { setTop(`Fix ${Object.keys(er).length} field${Object.keys(er).length > 1 ? 's' : ''} to continue.`); setTimeout(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(), 0); return; }
    setBusy(true); const r = onSubmit(fromForm(spec.filter((f) => !f.when || f.when(vals)), vals)); setBusy(false);
    if (r && !r.ok) { setTop(r.error ?? 'Could not save.'); return; } setDirty(false); if (draftKey) try { sessionStorage.removeItem('draft:' + draftKey); } catch { /* ignore */ }
  }}>
    {top && <Notice kind="bad">{top}</Notice>}
    <div className="grid-f">{spec.filter((f) => !f.when || f.when(vals)).map((f) => <FieldInput key={f.k} id={uidp + f.k} f={f} value={vals[f.k]} error={errs[f.k]} onChange={(v) => { setVals((o) => ({ ...o, [f.k]: v })); setDirty(true); setErrs((o) => ({ ...o, [f.k]: '' })); }} />)}</div>
    <div className="form-f">{dirty && <span className="dirty">{draftKey ? 'Draft saved on this device' : 'Unsaved changes'}</span>}{onCancel && <Button onClick={onCancel}>Cancel</Button>}<Button type="submit" variant="primary" disabled={busy}>{busy ? busyText ?? 'Saving…' : submit}</Button></div>
  </form>;
}

/* ---------- data table ---------- */
export interface Col { k: string; label: string; kind?: 'text' | 'money' | 'date' | 'badge' | 'num' | 'bool' | 'datetime'; render?: (r: any) => ReactNode; value?: (r: any) => any; hideMobile?: boolean; link?: (r: any) => string }
export interface RowAction { label: string; icon?: string; show?: (r: any) => boolean; run: (r: any) => void; danger?: boolean }
export interface TFilter { k: string; label: string; options: [string, string][] | string[]; value?: (r: any) => string }
function cellValue(c: Col, r: any) { return c.value ? c.value(r) : r[c.k]; }
function cellNode(c: Col, r: any): ReactNode {
  if (c.render) return c.render(r); const v = cellValue(c, r);
  const inner = c.kind === 'money' ? <Money v={v} /> : c.kind === 'date' ? date(v) : c.kind === 'datetime' ? dateTime(v) : c.kind === 'badge' ? (v ? <Badge v={v} /> : '—') : c.kind === 'bool' ? (v ? 'Yes' : 'No') : c.kind === 'num' ? <span className="num">{v}</span> : v === '' || v == null ? '—' : String(v);
  return c.link ? <Link to={c.link(r)}>{inner}</Link> : inner;
}
function csvEscape(x: any) { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function exportCsv(name: string, cols: Col[], rows: any[]) {
  const body = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => { const v = cellValue(c, r); return c.kind === 'money' ? (v / 100).toFixed(2) : v; }))].map((l) => l.map(csvEscape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DataTable({ id, rows, cols, filters = [], rowActions = [], bulk = [], onRowClick, pageSize = 10, empty, searchKeys, toolbar, preview, csvName, defaultSort, totalsFor }: {
  id: string; rows: any[]; cols: Col[]; filters?: TFilter[]; rowActions?: RowAction[]; bulk?: { label: string; run: (rows: any[]) => void; danger?: boolean }[]; onRowClick?: (r: any) => void; pageSize?: number; empty?: ReactNode; searchKeys?: string[]; toolbar?: ReactNode; preview?: (r: any) => ReactNode; csvName?: string; defaultSort?: [string, 'asc' | 'desc']; totalsFor?: string[];
}) {
  const store = (() => { try { return JSON.parse(sessionStorage.getItem('tbl:' + id) || '{}'); } catch { return {}; } })();
  const [q, setQ] = useState<string>(store.q ?? ''); const [fv, setFv] = useState<Record<string, string>>(store.fv ?? {}); const [sort, setSort] = useState<[string, 'asc' | 'desc'] | undefined>(store.sort ?? defaultSort); const [page, setPage] = useState<number>(store.page ?? 0);
  const [sel, setSel] = useState<Set<string>>(new Set()); const [open, setOpen] = useState<any | null>(null);
  const views = useRows('savedViews').filter((v) => v.tableId === id);
  useEffect(() => { try { sessionStorage.setItem('tbl:' + id, JSON.stringify({ q, fv, sort, page })); } catch { /* ignore */ } }, [id, q, fv, sort, page]);
  useEffect(() => { const y = Number(sessionStorage.getItem('scroll:' + id) || 0); if (y) setTimeout(() => window.scrollTo(0, y), 0); return () => { try { sessionStorage.setItem('scroll:' + id, String(window.scrollY)); } catch { /* ignore */ } }; }, [id]);
  const filtered = useMemo(() => {
    let r = rows; const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => (searchKeys ?? cols.map((c) => c.k)).some((k) => { const c = cols.find((cc) => cc.k === k); const v = c ? cellValue(c, x) : x[k]; return String(v ?? '').toLowerCase().includes(needle); }));
    filters.forEach((f) => { const val = fv[f.k]; if (val) r = r.filter((x) => String(f.value ? f.value(x) : x[f.k]) === val); });
    if (sort) { const c = cols.find((cc) => cc.k === sort[0]); if (c) r = [...r].sort((a, b) => { const x = cellValue(c, a), y = cellValue(c, b); const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return sort[1] === 'asc' ? d : -d; }); }
    return r;
  }, [rows, q, fv, sort, cols, filters, searchKeys]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); const cur = Math.min(page, pages - 1); const view = filtered.slice(cur * pageSize, cur * pageSize + pageSize);
  const allSel = view.length > 0 && view.every((r) => sel.has(r.id)); const hasAct = rowActions.length > 0 || !!preview;
  const totals = totalsFor?.map((k) => [k, filtered.reduce((s, r) => s + (Number(r[k]) || 0), 0)] as const);
  return <div className="tbl-wrap">
    <div className="tbl-bar" role="search">
      <label className="search"><Icon n="search" size={16} /><span className="sr">Search</span><input type="search" value={q} placeholder="Search…" onChange={(e) => { setQ(e.target.value); setPage(0); }} /></label>
      {filters.map((f) => <label key={f.k} className="sel"><span className="sr">{f.label}</span><select aria-label={f.label} value={fv[f.k] ?? ''} onChange={(e) => { setFv((o) => ({ ...o, [f.k]: e.target.value })); setPage(0); }}><option value="">{f.label}: all</option>{optPairs(f.options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
      {views.length > 0 && <label className="sel"><span className="sr">Saved views</span><select aria-label="Saved views" value="" onChange={(e) => { const v = views.find((x) => x.id === e.target.value); if (v) { setQ(v.q); setFv(v.fv); setSort(v.sort); setPage(0); } }}><option value="">Saved views…</option>{views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
      <div className="grow" />{toolbar}
      {(q || Object.values(fv).some(Boolean)) && <><Button variant="ghost" onClick={() => { const n = prompt('Name this view'); if (n?.trim()) { insert('savedViews', { tableId: id, name: n.trim(), q, fv, sort }); toast('View saved'); } }}>Save view</Button><Button variant="ghost" onClick={() => { setQ(''); setFv({}); setPage(0); }}>Clear</Button></>}
      {csvName && <Button variant="ghost" icon="download" onClick={() => { exportCsv(csvName, cols, filtered); toast(`Exported ${filtered.length} rows`); }}>CSV</Button>}
    </div>
    {sel.size > 0 && bulk.length > 0 && <div className="bulkbar" role="region" aria-label="Bulk actions"><b>{sel.size} selected</b>{bulk.map((b) => <Button key={b.label} variant={b.danger ? 'danger' : 'secondary'} onClick={() => { b.run(rows.filter((r) => sel.has(r.id))); setSel(new Set()); }}>{b.label}</Button>)}<Button variant="ghost" onClick={() => setSel(new Set())}>Clear selection</Button></div>}
    {filtered.length === 0 ? (rows.length === 0 ? (empty ?? <Empty title="Nothing here yet" text="Records will appear here once they are created." />) : <Empty title="No results" text="No records match your search or filters." action={<Button onClick={() => { setQ(''); setFv({}); }}>Clear filters</Button>} />) :
      <div className="tbl-scroll"><table className="tbl">
        <thead><tr>{bulk.length > 0 && <th className="chk"><input type="checkbox" aria-label="Select all on page" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...view.map((r) => r.id)]) : new Set([...sel].filter((x) => !view.some((r) => r.id === x))))} /></th>}
          {cols.map((c) => <th key={c.k} className={(c.kind === 'money' || c.kind === 'num' ? 'r ' : '') + (c.hideMobile ? 'hm' : '')} aria-sort={sort?.[0] === c.k ? (sort[1] === 'asc' ? 'ascending' : 'descending') : 'none'}><button className="th-b" onClick={() => setSort(sort?.[0] === c.k ? [c.k, sort[1] === 'asc' ? 'desc' : 'asc'] : [c.k, 'asc'])}>{c.label}{sort?.[0] === c.k && <span aria-hidden="true">{sort[1] === 'asc' ? ' ▲' : ' ▼'}</span>}</button></th>)}
          {hasAct && <th className="act"><span className="sr">Actions</span></th>}</tr></thead>
        <tbody>{view.map((r) => <tr key={r.id} className={onRowClick ? 'click' : ''} onClick={(e) => { if ((e.target as HTMLElement).closest('a,button,input,select,label')) return; onRowClick?.(r); }}>
          {bulk.length > 0 && <td className="chk"><input type="checkbox" aria-label={`Select row`} checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(r.id) : n.delete(r.id); setSel(n); }} /></td>}
          {cols.map((c) => <td key={c.k} data-l={c.label} className={(c.kind === 'money' || c.kind === 'num' ? 'r ' : '') + (c.hideMobile ? 'hm' : '')}>{cellNode(c, r)}</td>)}
          {hasAct && <td className="act">{preview && <Button variant="ghost" icon="eye" aria-label="Quick preview" onClick={() => setOpen(r)} />}{rowActions.filter((a) => !a.show || a.show(r)).map((a) => <Button key={a.label} variant={a.danger ? 'danger' : 'ghost'} onClick={() => a.run(r)}>{a.label}</Button>)}</td>}
        </tr>)}</tbody>
        {totals && <tfoot><tr>{bulk.length > 0 && <td />}{cols.map((c, i) => <td key={c.k} className={c.kind === 'money' ? 'r' : ''}>{i === 0 ? <b>Total ({filtered.length})</b> : totalsFor!.includes(c.k) ? <Money v={totals.find((t) => t[0] === c.k)![1]} bold /> : null}</td>)}{hasAct && <td />}</tr></tfoot>}
      </table></div>}
    <div className="pager"><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span><div><Button variant="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</Button><span className="pg">Page {cur + 1} of {pages}</span><Button variant="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</Button></div></div>
    {open && preview && <Modal drawer title="Quick preview" onClose={() => setOpen(null)}>{preview(open)}</Modal>}
  </div>;
}
export function KV({ row, skip = [] }: { row: any; skip?: string[] }) {
  const items = Object.entries(row).filter(([k, v]) => !skip.includes(k) && !['id', 'tenantId', 'password', 'lines', 'totals', 'history', 'revisions', 'runs', 'custom'].includes(k) && typeof v !== 'object').map(([k, v]) => [cap(k.replace(/([A-Z])/g, ' $1').toLowerCase()), /(amount|total|rate|limit|fee)$/i.test(k) && typeof v === 'number' ? money(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? date(String(v)) : String(v === '' ? '—' : v)] as [string, ReactNode]);
  return <Dl items={items} />;
}
