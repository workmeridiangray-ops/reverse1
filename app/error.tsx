"use client";
export default function Err({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="mx-auto max-w-md px-4 py-24 text-center"><h1 className="text-2xl font-semibold">Something went wrong</h1><p className="mt-2 text-muted">Nothing you submitted was lost without a message. You can try again. If it keeps happening, quote reference <code>{error.digest ?? "n/a"}</code> to support.</p><button onClick={reset} className="btn-primary mt-6">Try again</button></main>;
}
