import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { AREAS } from '@/lib/platform';
import { logoutAction } from '@/app/actions/auth';
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession(); if (!s) redirect('/login?expired=1'); if (!s.user.platformRole) redirect('/denied');
  const r = s.user.platformRole as any; const L = (h: string, t: string, a: string) => (AREAS[a] as string[]).includes(r) ? <Link key={h} href={h} className="px-3 min-h-[44px] flex items-center text-ink no-underline hover:bg-accent-soft rounded">{t}</Link> : null;
  return (<div className="min-h-screen"><header className="bg-ink text-white px-4 py-2 flex flex-wrap items-center gap-2"><strong className="mr-4">Buildline platform</strong><nav className="flex flex-wrap gap-1 bg-surface rounded">{L('/platform', 'Overview', 'businesses')}{L('/platform/businesses', 'Businesses', 'businesses')}{L('/platform/billing', 'Billing & plans', 'billing')}{L('/platform/ops', 'Operations & support', 'ops')}</nav><span className="ml-auto text-sm">{s.user.email} · {r}</span><form action={logoutAction}><button className="btn btn-sm">Sign out</button></form></header>
    <main id="main" className="max-w-6xl mx-auto px-4 py-6">{children}</main></div>);
}
