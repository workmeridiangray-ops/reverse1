import Link from 'next/link';
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 text-lg font-semibold text-ink no-underline">Buildline</Link>
      <main id="main" className="card w-full max-w-md p-6 md:p-8">{children}</main>
      <p className="mt-6 text-xs text-muted">Need help? <Link href="/contact">Contact support</Link></p>
    </div>
  );
}
