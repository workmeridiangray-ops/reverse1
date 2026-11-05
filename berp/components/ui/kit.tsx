import Link from "next/link";
import type { ReactNode } from "react";
import { formatInr } from "@/lib/rules/money";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{sub && <p className="mt-1 text-muted">{sub}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div role={error ? "alert" : "status"} className={`mb-4 rounded-md border px-4 py-3 ${error ? "border-danger bg-danger-bg text-danger" : "border-ok bg-ok-bg text-ok"}`}>
      {error ?? ok}
    </div>
  );
}

const TONES: Record<string, string> = {
  draft: "neutral", confirmed: "info", partially_dispatched: "warn", dispatched: "info", invoiced: "ok", cancelled: "neutral",
  posted: "info", partially_paid: "warn", paid: "ok", reversed: "danger",
  pending: "warn", approved: "ok", rejected: "danger",
  open: "info", partially_received: "warn", received: "ok", billed: "ok",
  trial: "warn", active: "ok", past_due: "danger", suspended: "danger",
};
export function Status({ value }: { value: string }) {
  const t = TONES[value] ?? "neutral";
  const cls: Record<string, string> = { neutral: "bg-neutral-bg text-neutral", info: "bg-info-bg text-info", warn: "bg-warn-bg text-warn", ok: "bg-ok-bg text-ok", danger: "bg-danger-bg text-danger" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls[t]}`}>{value.replace(/_/g, " ")}</span>;
}

export const Money = ({ paise }: { paise: number }) => <span className="tabular-nums">{formatInr(Number(paise))}</span>;
export const Qty = ({ v }: { v: number | string }) => <span className="tabular-nums">{Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</span>;

export function Field({ label, name, children, hint }: { label: string; name: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block" htmlFor={name}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export const TextInput = (p: React.InputHTMLAttributes<HTMLInputElement> & { name: string }) => <input id={p.name} className="input" {...p} />;

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-prose text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ head, children, numeric = [] }: { head: string[]; children: ReactNode; numeric?: number[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead><tr>{head.map((h, i) => <th key={h} scope="col" className={`th ${numeric.includes(i) ? "num" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const LinkBtn = ({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) =>
  <Link href={href} className={primary ? "btn btn-primary" : "btn"}>{children}</Link>;
