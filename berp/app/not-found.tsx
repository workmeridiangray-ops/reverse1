import Link from "next/link";
export default function NotFound() {
  return <main className="mx-auto max-w-prose p-10 text-center"><h1 className="text-2xl font-semibold">Page not found</h1><p className="mt-2 text-muted">It may have moved, or you may not have access.</p><Link className="btn mt-4" href="/app">Back to your workspace</Link></main>;
}
