import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/shell/Logo";
import { buttonClass } from "@/components/ui/Button";

const NAV = [["/features", "Features"], ["/pricing", "Pricing"], ["/demo", "Request a demo"]] as const;

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised">Skip to main content</a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
          <Link href="/" className="no-underline"><Logo /><span className="sr-only"> home</span></Link>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {NAV.map(([href, label]) => <Link key={href} href={href} className="flex min-h-touch items-center rounded px-3 font-bold text-ink-700 no-underline hover:bg-sunken">{label}</Link>)}
          </nav>
          <Link href="/login" className={`${buttonClass("primary")} ml-auto`}>Sign in</Link>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-page px-6 py-section">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap justify-between gap-4 px-6 py-6 text-sm text-ink-500">
          <p>Tendwell hospital management. Clinical rules are configured and approved by each hospital.</p>
          <nav aria-label="Legal" className="flex gap-4"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
        </div>
      </footer>
    </>
  );
}
