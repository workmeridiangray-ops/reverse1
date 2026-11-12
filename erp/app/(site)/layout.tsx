import Link from "next/link";
import { getCtx } from "@/lib/auth/session";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  return (
    <>
      <header className="site-head">
        <Link href="/" className="brand" style={{ padding: 0 }}><i />Ledgerline</Link>
        <nav aria-label="Main">
          <Link href="/features">Product</Link><Link href="/solutions">Solutions</Link><Link href="/pricing">Pricing</Link><Link href="/add-ons">Add-ons</Link><Link href="/help">Help</Link><Link href="/contact">Contact</Link>
        </nav>
        <div className="row">
          {ctx ? <Link className="btn primary sm" href="/workspaces">Open workspace</Link> : <><Link className="btn sm" href="/login">Sign in</Link><Link className="btn primary sm" href="/signup">Start free trial</Link></>}
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site"><div className="wrap">
        <p><strong>Ledgerline</strong> — multi-company ERP for trading and service businesses.</p>
        <p><Link href="/features">Product</Link><Link href="/pricing">Pricing</Link><Link href="/updates">Updates</Link><Link href="/help">Help</Link><Link href="/demo">Request a demo</Link>
          <Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/refunds">Refunds</Link><Link href="/legal/security">Security</Link></p>
      </div></footer>
    </>
  );
}
