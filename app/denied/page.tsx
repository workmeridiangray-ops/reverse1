import Link from "next/link";
export const metadata = { title: "Access denied" };
export default function Denied() {
  return (
    <main id="main" className="mx-auto max-w-prose px-4 py-24 text-center">
      <h1 className="text-display font-bold">Access denied</h1>
      <p className="mt-3 text-ink-700">Your role does not permit this action or screen. Ask a business owner to change your role if you need access.</p>
      <p className="mt-6"><Link href="/app">Back to your workspace</Link></p>
    </main>
  );
}
