import type { ReactNode } from "react";
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-caption font-bold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-title font-bold">{value}</p>
      {hint ? <p className="mt-1 text-caption text-ink-500">{hint}</p> : null}
    </div>
  );
}
