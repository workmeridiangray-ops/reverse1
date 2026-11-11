import Link from "next/link";
import { getAuth } from "@/lib/server/auth";
export async function SiteShell({ children }: { children: React.ReactNode }) {
  const a = await getAuth(); const signedIn = a && !("expired" in a);
  const nav = [["/product", "Product"], ["/solutions", "Solutions"], ["/pricing", "Pricing"], ["/help", "Help"], ["/contact", "Contact"]];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight text-brand">Forgeline</Link>
          <nav aria-label="Main" className="hidden gap-5 text-sm md:flex">{nav.map(([h, t]) => <Link key={h} href={h!} className="text-muted hover:text-ink">{t}</Link>)}</nav>
          <div className="flex items-center gap-2">
            {signedIn ? <Link href="/app" className="btn-primary btn-sm">Open app</Link> : <><Link href="/login" className="btn-secondary btn-sm">Sign in</Link><Link href="/signup" className="btn-primary btn-sm">Start free trial</Link></>}
          </div>
        </div>
        <nav aria-label="Main mobile" className="flex gap-4 overflow-x-auto border-t border-line px-4 py-2 text-sm md:hidden">{nav.map(([h, t]) => <Link key={h} href={h!} className="whitespace-nowrap text-muted">{t}</Link>)}</nav>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-4">
          <div><div className="font-semibold text-brand">Forgeline</div><p className="mt-2 text-muted">Manufacturing ERP and production planning for discrete manufacturers.</p></div>
          <div><div className="font-medium">Product</div><ul className="mt-2 space-y-1 text-muted"><li><Link href="/product">Features</Link></li><li><Link href="/solutions">Industries</Link></li><li><Link href="/pricing">Pricing</Link></li><li><Link href="/addons">Add-ons</Link></li><li><Link href="/updates">Updates</Link></li></ul></div>
          <div><div className="font-medium">Company</div><ul className="mt-2 space-y-1 text-muted"><li><Link href="/demo">Request a demo</Link></li><li><Link href="/contact">Contact</Link></li><li><Link href="/help">Help</Link></li></ul></div>
          <div><div className="font-medium">Legal</div><ul className="mt-2 space-y-1 text-muted"><li><Link href="/legal/terms">Terms</Link></li><li><Link href="/legal/privacy">Privacy</Link></li><li><Link href="/legal/refunds">Refunds</Link></li><li><Link href="/legal/security">Security</Link></li></ul></div>
        </div>
      </footer>
    </div>
  );
}
