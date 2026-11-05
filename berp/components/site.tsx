import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">BERP</Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          <Link className="btn border-transparent" href="/pricing">Pricing</Link>
          <Link className="btn" href="/login">Sign in</Link>
          <Link className="btn btn-primary" href="/signup">Start trial</Link>
        </nav>
      </div>
    </header>
  );
}
export function SiteFooter() {
  return <footer className="mx-auto max-w-page px-4 py-10 text-sm text-muted">© BERP. Prices in INR, exclusive of applicable taxes.</footer>;
}
