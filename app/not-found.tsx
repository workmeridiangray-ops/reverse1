import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-prose px-4 py-24 text-center">
      <h1 className="text-display font-bold">Page not found</h1>
      <p className="mt-3 text-ink-700">The page does not exist, or the record is not available to your account.</p>
      <p className="mt-6"><Link href="/app">Go to your workspace</Link> · <Link href="/">Home</Link></p>
    </main>
  );
}
