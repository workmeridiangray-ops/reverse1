import Link from "next/link";
export default function NotFound() {
  return <main id="main" className="mx-auto max-w-md px-4 py-24 text-center"><h1 className="text-2xl font-semibold">We can’t find that page</h1><p className="mt-2 text-muted">The link may be wrong, or the record may belong to another workspace.</p><Link href="/" className="btn-primary mt-6">Go home</Link></main>;
}
