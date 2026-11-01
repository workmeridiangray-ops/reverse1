import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-prose px-6 py-section">
      <h1 className="text-display font-bold">Not found</h1>
      <p className="mt-2 text-lg text-ink-700">This record doesn&apos;t exist, or your role can&apos;t see it.</p>
      <p className="mt-6"><Link href="/">Go to your home screen</Link></p>
    </main>
  );
}
