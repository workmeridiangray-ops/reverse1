import Link from "next/link";
import type { ReactNode } from "react";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";
import { buttonClass } from "@/components/ui/Button";

const NAV = [["Features", "/features"], ["Solutions", "/solutions"], ["Pricing", "/pricing"], ["Help", "/help"], ["Contact", "/contact"]] as const;

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-title font-bold text-ink-900 no-underline">{PRODUCT_NAME}</Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            {NAV.map(([l, h]) => <Link key={h} href={h} className="inline-flex min-h-touch items-center px-3 text-ink-700 no-underline hover:text-brand-700">{l}</Link>)}
            <Link href="/login" className={buttonClass("secondary", "sm")}>Sign in</Link>
            <Link href="/signup" className={buttonClass("primary", "sm")}>Start free trial</Link>
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="mt-24 border-t border-line bg-surface">
        <div className="mx-auto grid max-w-page gap-8 px-4 py-10 sm:grid-cols-3">
          <div><p className="font-bold">{PRODUCT_NAME}</p><p className="mt-2 text-sm text-ink-500">{PRODUCT_TAGLINE}</p></div>
          <nav aria-label="Product" className="flex flex-col gap-1 text-sm">
            <Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/demo">Request a demo</Link><Link href="/updates">Product updates</Link>
          </nav>
          <nav aria-label="Legal" className="flex flex-col gap-1 text-sm">
            <Link href="/legal/terms">Terms of service</Link><Link href="/legal/privacy">Privacy policy</Link><Link href="/legal/security">Security</Link><Link href="/help">Help centre</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
