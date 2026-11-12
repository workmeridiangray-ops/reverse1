import Link from 'next/link';
export default function Site({ children }: { children: React.ReactNode }) {
  const N = [['/features', 'Product'], ['/solutions', 'Solutions'], ['/pricing', 'Pricing'], ['/updates', 'Updates'], ['/help', 'Help']];
  return (<div className="min-h-screen flex flex-col"><header className="bg-surface border-b border-line"><div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-4"><Link href="/" className="text-lg font-semibold text-ink no-underline">Buildline</Link>
    <nav aria-label="Main" className="flex flex-wrap gap-1">{N.map(([h, t]) => <Link key={h} href={h} className="px-3 min-h-[44px] flex items-center text-ink no-underline hover:bg-accent-soft rounded">{t}</Link>)}</nav>
    <span className="ml-auto flex gap-2"><Link href="/login" className="btn btn-sm">Sign in</Link><Link href="/signup" className="btn btn-sm btn-primary">Start free trial</Link></span></div></header>
    <main id="main" className="flex-1 max-w-6xl w-full mx-auto px-4 py-10">{children}</main>
    <footer className="border-t border-line bg-surface"><div className="max-w-6xl mx-auto px-4 py-6 text-sm text-muted flex flex-wrap gap-4"><span>© Buildline</span><Link href="/legal/terms" className="text-muted">Terms</Link><Link href="/legal/privacy" className="text-muted">Privacy</Link><Link href="/legal/refunds" className="text-muted">Refunds</Link><Link href="/contact" className="text-muted">Contact</Link><Link href="/demo" className="text-muted">Book a demo</Link></div></footer></div>);
}
