"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <main className="mx-auto max-w-prose p-10 text-center"><h1 className="text-2xl font-semibold">Something went wrong</h1><p className="mt-2 text-muted">The request failed. Your data was not changed.</p><button className="btn mt-4" onClick={reset}>Try again</button></main>;
}
