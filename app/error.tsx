"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-prose px-4 py-24 text-center">
      <h1 className="text-display font-bold">Something went wrong</h1>
      <p className="mt-3 text-ink-700">Nothing you entered was lost on the server. Try again; if it keeps happening contact support.</p>
      <button onClick={reset} className="mt-6 min-h-touch rounded border border-brand-700 bg-brand-700 px-4 font-bold text-white">Try again</button>
    </main>
  );
}
