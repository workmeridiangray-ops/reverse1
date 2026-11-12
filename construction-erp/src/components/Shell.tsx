import Link from 'next/link';
import { Bell, Building2, ChevronDown, CircleHelp, FolderKanban, Inbox, LayoutDashboard, LogOut, Search, Settings, Users, FileSignature, ShieldCheck, Menu } from 'lucide-react';
import type { SessionInfo } from '@/lib/session';
import { logoutAction, switchWorkspaceAction, markNotificationsReadAction } from '@/app/actions/auth';
import { Alert } from './ui';
import { withTenant, one } from '@/lib/db';

export default async function Shell({ s, perms, children }: { s: SessionInfo & { ctx: NonNullable<SessionInfo['ctx']>; org: NonNullable<SessionInfo['org']> }; perms: Set<string>; children: React.ReactNode }) {
  const unread = await withTenant(s.ctx, async q => Number((await one<any>(q, 'select count(*) n from notifications where read_at is null'))!.n));
  const has = (p: string) => perms.has(p);
  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { href: '/inbox', label: 'Decisions inbox', icon: Inbox, show: true },
    { href: '/tenders', label: 'Tenders & estimates', icon: FileSignature, show: has('tender:view') },
    { href: '/o/parties', label: 'Companies & contacts', icon: Building2, show: has('project:view') },
    { href: '/settings/team', label: 'Team & access', icon: Users, show: has('team:view') },
    { href: '/settings', label: 'Settings & billing', icon: Settings, show: has('settings:view') || has('team:view') },
    { href: '/settings/audit', label: 'Audit trail', icon: ShieldCheck, show: has('audit:view') },
  ].filter(n => n.show);
  const sub = s.sub;
  const daysLeft = (d: string | null) => d ? Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)) : 0;
  const NavLinks = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {nav.map(n => <Link key={n.href} href={n.href} className="flex items-center gap-3 px-3 min-h-[44px] rounded text-ink no-underline hover:bg-accent-soft"><n.icon size={18} aria-hidden /> {n.label}</Link>)}
    </nav>
  );
  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden md:flex md:w-64 shrink-0 flex-col border-r border-line bg-surface p-4 gap-6 sticky top-0 h-screen overflow-y-auto">
        <Link href="/dashboard" className="text-lg font-semibold text-ink no-underline flex items-center gap-2"><FolderKanban size={20} aria-hidden /> Buildline</Link>
        <div className="rounded border border-line p-3 text-sm bg-bg">
          <p className="text-xs uppercase tracking-wide text-muted">Workspace</p>
          <p className="font-semibold truncate">{s.org.name}</p>
          <p className="text-xs text-muted capitalize">{s.ctx.role}{sub ? ` · ${sub.planName}` : ''}</p>
        </div>
        {NavLinks}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-surface border-b border-line px-4 py-2 flex items-center gap-3">
          <details className="md:hidden relative">
            <summary className="btn btn-sm list-none cursor-pointer" aria-label="Open menu"><Menu size={18} aria-hidden /></summary>
            <div className="absolute left-0 mt-2 w-72 card p-3 shadow-lg">{NavLinks}</div>
          </details>
          <form action="/search" className="flex-1 max-w-md relative" role="search">
            <Search size={16} className="absolute left-3 top-3.5 text-muted" aria-hidden />
            <input name="q" type="search" aria-label="Search projects, records and companies" placeholder="Search projects, drawings, POs…" className="input pl-9" />
          </form>
          <details className="relative ml-auto">
            <summary className="btn btn-sm list-none cursor-pointer gap-1" aria-label="Switch workspace"><span className="max-w-[10rem] truncate">{s.org.name}</span><ChevronDown size={14} aria-hidden /></summary>
            <div className="absolute right-0 mt-2 w-72 card p-2 z-40">
              <p className="px-2 py-1 text-xs uppercase tracking-wide text-muted">Your workspaces</p>
              {s.memberships.map(m => (
                <form key={m.orgId} action={switchWorkspaceAction}><input type="hidden" name="org" value={m.orgId} />
                  <button className={`w-full text-left px-2 min-h-[44px] rounded hover:bg-accent-soft ${m.orgId === s.org.id ? 'font-semibold' : ''}`}>{m.orgName} <span className="text-xs text-muted">({m.role})</span></button></form>
              ))}
              <Link href="/signup" className="block px-2 py-2 text-sm">Create another workspace</Link>
            </div>
          </details>
          <Link href="/notifications" className="btn btn-sm relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Bell size={18} aria-hidden />{unread > 0 && <span className="absolute -top-1 -right-1 bg-bad text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center">{unread}</span>}</Link>
          <Link href="/help" className="btn btn-sm hidden sm:inline-flex" aria-label="Help"><CircleHelp size={18} aria-hidden /></Link>
          <details className="relative">
            <summary className="btn btn-sm list-none cursor-pointer">{s.user.name.split(' ')[0]}</summary>
            <div className="absolute right-0 mt-2 w-56 card p-2 z-40">
              <p className="px-2 py-1 text-xs text-muted truncate">{s.user.email}</p>
              <Link href="/account" className="block px-2 py-2">Profile</Link>
              <Link href="/account/security" className="block px-2 py-2">Security & 2FA</Link>
              <Link href="/account/sessions" className="block px-2 py-2">Active sessions</Link>
              <Link href="/account/notifications" className="block px-2 py-2">Notification preferences</Link>
              <form action={logoutAction}><button className="flex items-center gap-2 w-full px-2 min-h-[44px] text-left hover:bg-accent-soft rounded"><LogOut size={16} aria-hidden /> Sign out</button></form>
            </div>
          </details>
        </header>
        <div className="space-y-2 px-4 md:px-8 pt-4 empty:hidden">
          {sub?.state === 'trialing' && <Alert kind="info"><strong>Free trial:</strong> {daysLeft(sub.trialEndsAt)} day(s) left. <Link href="/settings/billing">Choose a plan</Link></Alert>}
          {sub?.state === 'grace' && <Alert kind="warn" title="Payment overdue"><span>Your renewal has not been paid. You keep full access until {sub.graceUntil ? new Date(sub.graceUntil).toLocaleDateString('en-IN') : 'the grace period ends'}, then the workspace becomes read-only. <Link href="/settings/billing">Pay now</Link></span></Alert>}
          {sub && ['expired', 'cancelled'].includes(sub.state) && <Alert kind="bad" title="Read-only mode">Your subscription has ended. Your data is safe and viewable, but changes are blocked. <Link href="/settings/billing">Renew to continue</Link></Alert>}
        </div>
        <main id="main" className="flex-1 px-4 md:px-8 py-6 max-w-[1280px] w-full">{children}</main>
        <footer className="px-4 md:px-8 py-4 text-xs text-muted border-t border-line">Buildline · <Link href="/help" className="text-muted">Help</Link> · <Link href="/legal/privacy" className="text-muted">Privacy</Link></footer>
      </div>
    </div>
  );
}
