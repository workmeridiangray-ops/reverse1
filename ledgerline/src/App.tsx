import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SCREENS, type Screen, type Area } from './registry';
import { PublicLayout, Logo } from './screens/public';
import { Icon, Toasts, Button, Empty } from './ui/kit';
import { useSession, useStore, useRows, logout, expireSession, switchWorkspace, workspacesFor, update, setBranch, getState, scoped, onSyncError } from './store';
import { toast } from './ui/kit';
import { tenantMeta } from './data/seed';
import { cap, dateTime, money } from './lib/format';

class Boundary extends Component<{ children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() { if (!this.state.err) return this.props.children; return <div className="content"><Empty title="This screen hit a problem" text="Your data is safe. Try again, or go back to the dashboard." action={<div className="pill-row" style={{ justifyContent: 'center' }}><Button variant="primary" onClick={() => this.setState({ err: undefined })}>Try again</Button><Link className="btn secondary" to="/" onClick={() => this.setState({ err: undefined })}>Home</Link></div>} /></div>; }
}
function ScrollTop() { const { pathname } = useLocation(); useEffect(() => { window.scrollTo(0, 0); document.getElementById('main')?.focus(); }, [pathname]); return null; }

/** Server-style guard: membership, status, role and area are checked on every navigation. */
function Guard({ area, children }: { area: 'app' | 'portal' | 'admin'; children: ReactNode }) {
  const s = useSession(); const expired = useStore((st) => st.flags.expiredSession); const booting = useStore((st) => !!st.flags.booting); const members = useRows('members'); const links = useRows('portalLinks'); const loc = useLocation();
  if (booting) return <div className="auth" role="status" aria-live="polite"><div className="auth-card"><div className="skel" style={{ width: '60%' }} /><p style={{ color: 'var(--muted)' }}>Loading your workspace…</p></div></div>;
  if (!s) return <Navigate to={expired ? '/expired' : '/login'} replace state={{ from: loc.pathname }} />;
  if (s.mfaPending) return <Navigate to="/2fa" replace />;
  if (area === 'app') { if (s.customerId) return <Navigate to="/portal" replace />; if (s.platformRole) return <Navigate to="/admin" replace />; const m = getState().db.members.find((x) => x.id === s.memberId); if (!m || m.status !== 'active') { return <Navigate to="/suspended" replace />; } }
  if (area === 'portal') { if (!s.customerId) return <Navigate to={s.platformRole ? '/admin' : '/app'} replace />; const l = getState().db.portalLinks.find((x) => x.customerId === s.customerId); if (!l?.active) return <Navigate to="/suspended" replace />; }
  if (area === 'admin' && !s.platformRole) return <Navigate to={s.customerId ? '/portal' : '/app'} replace />;
  void members; void links; return <>{children}</>;
}
function RoleGate({ roles, children }: { roles?: string[]; children: ReactNode }) {
  const s = useSession(); if (!roles || !s) return <>{children}</>;
  const mine = s.platformRole ?? s.role; if (roles.includes(mine) || (roles.includes('platform') && s.platformRole)) return <>{children}</>;
  return <Navigate to="/denied" replace />;
}
function useIdleLogout(minutes = 30) {
  const nav = useNavigate();
  useEffect(() => { let t: ReturnType<typeof setTimeout>; const reset = () => { clearTimeout(t); t = setTimeout(() => { expireSession(); nav('/expired'); }, minutes * 60000); }; const ev = ['click', 'keydown', 'mousemove', 'touchstart']; ev.forEach((e) => window.addEventListener(e, reset, { passive: true })); reset(); return () => { clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, reset)); }; }, [nav, minutes]);
}
function groups(area: Area, role?: string) {
  const g = new Map<string, Screen[]>(); SCREENS.filter((s) => s.area === area && s.nav && (!s.roles || !role || s.roles.includes(role) || (s.roles.includes('platform') && !!role))).forEach((s) => { if (!g.has(s.group!)) g.set(s.group!, []); g.get(s.group!)!.push(s); });
  return [...g];
}
function Search() {
  const [q, setQ] = useState(''); const nav = useNavigate(); const ref = useRef<HTMLInputElement>(null); const sess = useSession();
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement).tagName)) { e.preventDefault(); ref.current?.focus(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const res = useMemo(() => {
    const n = q.trim().toLowerCase(); if (n.length < 2) return []; const st = getState(); const out: { to: string; t: string; s: string }[] = [];
    scoped(st, 'customers').filter((c) => (c.name + c.code + c.gstin).toLowerCase().includes(n)).slice(0, 4).forEach((c) => out.push({ to: `/app/masters/customers/${c.id}`, t: c.name, s: 'Customer · ' + c.code }));
    scoped(st, 'invoices').filter((i) => ((i.number ?? '') + i.customer).toLowerCase().includes(n)).slice(0, 5).forEach((i) => out.push({ to: `/app/invoices/${i.id}`, t: i.number || 'Draft invoice', s: `Invoice · ${i.customer} · ${money(i.total)}` }));
    scoped(st, 'receipts').filter((r) => (r.number + r.ref + r.customer).toLowerCase().includes(n)).slice(0, 3).forEach((r) => out.push({ to: `/app/receipts/${r.id}/allocate`, t: r.number, s: `Receipt · ${r.customer} · ref ${r.ref}` }));
    scoped(st, 'quotes').filter((x) => ((x.number ?? '') + x.customer).toLowerCase().includes(n)).slice(0, 3).forEach((x) => out.push({ to: `/app/quotes/${x.id}`, t: x.number || 'Draft quotation', s: 'Quotation · ' + x.customer }));
    scoped(st, 'suppliers').filter((x) => x.name.toLowerCase().includes(n)).slice(0, 2).forEach((x) => out.push({ to: `/app/payables/statements?supplier=${x.id}`, t: x.name, s: 'Supplier' }));
    SCREENS.filter((s) => s.area === 'app' && !s.path.includes(':') && s.title.toLowerCase().includes(n)).slice(0, 4).forEach((s) => out.push({ to: s.path, t: s.title, s: 'Go to screen' }));
    return out;
  }, [q, sess?.tenantId]);
  return <div className="gs" role="search"><Icon n="search" size={16} /><label className="sr" htmlFor="gs">Search customers, invoices, receipts</label><input id="gs" ref={ref} type="search" placeholder="Search customers, invoices, receipts…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} autoComplete="off" />
    {q.trim().length >= 2 && <div className="gs-res" role="listbox">{res.length ? res.map((r) => <a key={r.to + r.t} role="option" href={'#' + r.to} onClick={(e) => { e.preventDefault(); setQ(''); nav(r.to); }}>{r.t}<small>{r.s}</small></a>) : <div style={{ padding: 14, color: 'var(--muted)' }}>No matches for “{q}”.</div>}</div>}</div>;
}
function Notifications() {
  const [open, setOpen] = useState(false); const notes = useRows('notifications'); const nav = useNavigate(); const unread = notes.filter((n) => !n.read).length;
  return <div className="rel"><button className="btn ghost" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)} style={{ position: 'relative', minWidth: 40 }}><Icon n="bell" />{unread > 0 && <span className="dot" aria-hidden="true">{unread}</span>}</button>
    {open && <div className="menu-pop" role="menu" style={{ width: 340 }}><h4>Notifications</h4>{notes.length ? [...notes].sort((a, b) => b.at.localeCompare(a.at)).map((n) => <div key={n.id} className={'n' + (n.read ? '' : ' un')}><a href={'#' + n.link} onClick={(e) => { e.preventDefault(); update('notifications', n.id, { read: true }); setOpen(false); nav(n.link); }} style={{ padding: 0, minHeight: 0 }}>{n.text}</a><div style={{ color: 'var(--muted)', fontSize: 12 }}>{dateTime(n.at)}</div></div>) : <div className="n">You’re all caught up.</div>}{unread > 0 && <button onClick={() => notes.forEach((n) => update('notifications', n.id, { read: true }))}>Mark all read</button>}</div>}</div>;
}
function UserMenu() {
  const s = useSession()!; const nav = useNavigate(); const [open, setOpen] = useState(false); const ws = workspacesFor(s.email);
  return <div className="rel"><button className="btn secondary" aria-label={`Account menu for ${s.name}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}><Icon n="users" size={16} /><span className="hm-sm">{s.name.split(' ')[0]}</span><Icon n="down" size={14} /></button>
    {open && <div className="menu-pop" role="menu" onClick={() => setOpen(false)}><div className="n"><b>{s.name}</b><br /><small>{s.email} · {cap(s.platformRole?.replace('platform_', 'platform ') ?? s.role)}</small></div>{!s.platformRole && !s.customerId && <><Link role="menuitem" to="/app/account/profile">Profile</Link><Link role="menuitem" to="/app/account/security">Security</Link><Link role="menuitem" to="/app/account/sessions">Active sessions</Link><Link role="menuitem" to="/app/account/notifications">Notification preferences</Link></>}
      {ws.length > 1 && <><h4>Switch workspace</h4>{ws.filter((w) => w.tenantId !== s.tenantId).map((w) => <button role="menuitem" key={w.id} onClick={() => { switchWorkspace(w.id); nav('/app'); }}><Icon n="swap" size={16} />{w.tenant.name}</button>)}</>}
      <button role="menuitem" onClick={() => { logout(); nav('/'); }}><Icon n="logout" size={16} />Sign out</button></div>}</div>;
}
function AppShell({ area }: { area: 'app' | 'admin' }) {
  const s = useSession()!; const [open, setOpen] = useState(false); const loc = useLocation(); const branches = useRows('branches'); const branchId = useStore((st) => st.flags.branchId); useIdleLogout();
  useEffect(() => setOpen(false), [loc.pathname]);
  const g = groups(area, s.platformRole ?? s.role); const T = tenantMeta(s.tenantId);
  return <div className="app"><aside className={'side' + (open ? ' open' : '')} aria-label="Primary"><Logo to={area === 'admin' ? '/admin' : '/app'} />
    {area === 'app' ? <div className="ws"><b>{T?.name}</b><span>{cap(s.role)} · {T?.city}</span></div> : <div className="ws"><b>Platform admin</b><span>{cap(s.platformRole!.replace('platform_', ''))}</span></div>}
    <nav className="nav">{g.map(([name, list]) => <div key={name}><h4>{name}</h4>{list.map((sc) => <NavLink key={sc.path} to={sc.path} end={sc.path === '/app' || sc.path === '/admin'} className={({ isActive }) => (isActive ? 'on' : '')}><Icon n={sc.icon ?? 'chev'} size={16} />{sc.title}</NavLink>)}</div>)}
      {area === 'app' && <div><h4>More</h4><NavLink to="/app/help"><Icon n="help" size={16} />Help</NavLink><NavLink to="/app/screens"><Icon n="menu" size={16} />All screens</NavLink></div>}</nav></aside>
    <div className="main"><header className="top"><button className="btn ghost menu" aria-label="Open menu" onClick={() => setOpen(!open)}><Icon n="menu" /></button>{area === 'app' ? <><Search />
      <label className="sel" style={{ maxWidth: 190 }}><span className="sr">Branch</span><select aria-label="Branch context" value={branchId ?? ''} onChange={(e) => setBranch(e.target.value)}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></> : <b>Platform administration</b>}
      <div className="grow" />{area === 'app' && <><Link to="/app/help" className="btn ghost" aria-label="Help"><Icon n="help" /></Link><Notifications /></>}<UserMenu /></header>
      <main id="main" tabIndex={-1} className="content"><Boundary><Outlet /></Boundary></main></div></div>;
}
function PortalShell() {
  const s = useSession()!; const nav = useNavigate(); const items = SCREENS.filter((x) => x.area === 'portal' && x.nav); const st = getState().settings[s.tenantId]; useIdleLogout();
  return <><header className="pub-top"><span className="brand"><span className="lg"><Icon n="menu" size={16} /></span>{st?.branding.logoText ?? 'Portal'}</span><nav aria-label="Portal">{items.map((i) => <NavLink key={i.path} to={i.path} end={i.path === '/portal'} className={({ isActive }) => (isActive ? 'on' : '')}>{i.title}</NavLink>)}</nav><span style={{ color: 'var(--muted)', fontSize: 14 }}>{s.name}</span><Button onClick={() => { logout(); nav('/'); }}>Sign out</Button></header><main id="main" tabIndex={-1} className="content"><Boundary><Outlet /></Boundary></main></>;
}
const NotFound = () => <div className="auth"><div className="auth-card" style={{ textAlign: 'center' }}><Logo /><h1 style={{ marginTop: 12 }}>Page not found</h1><p style={{ color: 'var(--muted)' }}>That page doesn’t exist or has moved.</p><Link to="/" className="btn primary">Go home</Link></div></div>;

export default function App() {
  useEffect(() => { onSyncError((m) => toast('Not saved: ' + m, 'err')); }, []);
  const uniq = (list: Screen[]) => { const seen = new Set<string>(); return list.filter((s) => (seen.has(s.path) ? false : (seen.add(s.path), true))); };
  const pubs = uniq(SCREENS.filter((s) => s.area === 'public')), auths = uniq(SCREENS.filter((s) => s.area === 'auth')), apps = uniq(SCREENS.filter((s) => s.area === 'app')), portals = uniq(SCREENS.filter((s) => s.area === 'portal')), admins = uniq(SCREENS.filter((s) => s.area === 'admin'));
  const rel = (p: string, base: string) => (p === base ? '' : p.slice(base.length + 1));
  return <HashRouter><ScrollTop /><Toasts /><Routes>
    <Route element={<PublicLayout />}>{pubs.map((s) => <Route key={s.path} path={s.path === '/' ? undefined : s.path} index={s.path === '/'} element={s.el} />)}</Route>
    {auths.map((s) => <Route key={s.path} path={s.path} element={s.el} />)}
    <Route path="/app" element={<Guard area="app"><AppShell area="app" /></Guard>}>{apps.map((s) => <Route key={s.path} index={s.path === '/app'} path={s.path === '/app' ? undefined : rel(s.path, '/app')} element={<RoleGate roles={s.roles}>{s.el}</RoleGate>} />)}<Route path="*" element={<Empty title="Screen not found" action={<Link to="/app" className="btn primary">Dashboard</Link>} />} /></Route>
    <Route path="/portal" element={<Guard area="portal"><PortalShell /></Guard>}>{portals.map((s) => <Route key={s.path} index={s.path === '/portal'} path={s.path === '/portal' ? undefined : rel(s.path, '/portal')} element={s.el} />)}<Route path="*" element={<Empty title="Screen not found" action={<Link to="/portal" className="btn primary">Home</Link>} />} /></Route>
    <Route path="/admin" element={<Guard area="admin"><AppShell area="admin" /></Guard>}>{admins.map((s) => <Route key={s.path} index={s.path === '/admin'} path={s.path === '/admin' ? undefined : rel(s.path, '/admin')} element={<RoleGate roles={s.roles}>{s.el}</RoleGate>} />)}<Route path="*" element={<Empty title="Screen not found" action={<Link to="/admin" className="btn primary">Overview</Link>} />} /></Route>
    <Route path="*" element={<NotFound />} /></Routes></HashRouter>;
}
