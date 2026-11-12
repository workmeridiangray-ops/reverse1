import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { logoutAction, switchWorkspaceAction } from '@/app/actions/auth';
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (<div className="min-h-screen"><header className="bg-surface border-b border-line px-4 py-3 flex flex-wrap items-center gap-3 justify-between"><Link href="/portal" className="font-semibold text-ink no-underline">{s.org.name} · Project portal</Link>
    <span className="flex items-center gap-3 text-sm">{s.memberships.length > 1 && s.memberships.map(m => <form key={m.orgId} action={switchWorkspaceAction}><input type="hidden" name="org" value={m.orgId} /><button className="underline text-accent">{m.orgName}</button></form>)}<span className="text-muted">{s.user.name} ({s.ctx.role})</span><form action={logoutAction}><button className="btn btn-sm">Sign out</button></form></span></header>
    <main id="main" className="max-w-5xl mx-auto px-4 py-6">{children}</main></div>);
}
