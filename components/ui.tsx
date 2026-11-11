import Link from "next/link";
import type { ReactNode } from "react";

export function Page({ title, sub, actions, children, crumbs }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode; crumbs?: [string, string?][] }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      {crumbs && <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">{crumbs.map(([t, h], i) => <span key={i}>{i > 0 && " / "}{h ? <Link href={h} className="hover:underline">{t}</Link> : t}</span>)}</nav>}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{sub && <p className="mt-1 max-w-prose text-sm text-muted">{sub}</p>}</div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
export const Card = ({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) => (
  <section className={`card p-4 ${className}`}>{(title || actions) && <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{actions}</div>}{children}</section>
);
const TONE: Record<string, string> = {
  ok: "bg-[#E4F3EA] text-ok", warn: "bg-[#FBF0D9] text-warn", danger: "bg-[#FBE6E6] text-danger", info: "bg-[#E3ECF6] text-info", neutral: "bg-sunken text-muted",
};
const STATUS_TONE: Record<string, string> = {
  active: "ok", approved: "ok", released: "info", passed: "ok", received: "ok", completed: "ok", closed: "neutral", delivered: "ok", paid: "ok", available: "ok", done: "ok", confirmed: "info", in_progress: "info", running: "info", dispatched: "info", trialing: "info", processed: "ok", sent: "ok", restocked: "ok", dispositioned: "ok",
  draft: "neutral", planned: "neutral", pending: "warn", pending_approval: "warn", partial: "warn", quarantine: "warn", suggested: "warn", packing: "warn", paused: "warn", open: "warn", queued: "warn", past_due: "warn", awaiting_inspection: "warn", requested: "warn",
  failed: "danger", rejected: "danger", cancelled: "danger", suspended: "danger", dead: "danger", disputed: "danger", expired: "danger", obsolete: "neutral", dismissed: "neutral", scrapped: "danger", refunded: "neutral", void: "neutral", trial: "info", running_: "info",
};
export const Badge = ({ s, label }: { s: string; label?: string }) => <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[STATUS_TONE[s] ?? "neutral"]}`}>{label ?? s.replace(/_/g, " ")}</span>;

export function Field({ label, name, type = "text", hint, defaultValue, required, placeholder, options, step, min, max, rows, className = "", disabled }: {
  label: string; name: string; type?: string; hint?: string; defaultValue?: string | number | null; required?: boolean; placeholder?: string;
  options?: { value: string; label: string }[]; step?: string; min?: string | number; max?: string | number; rows?: number; className?: string; disabled?: boolean;
}) {
  const id = "f-" + name + label.length;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{required && <span aria-hidden className="text-danger"> *</span>}</label>
      {options ? (
        <select id={id} name={name} required={required} defaultValue={defaultValue ?? ""} className="input" disabled={disabled}>
          {!required && <option value="">— none —</option>}{required && !defaultValue && <option value="" disabled>Select…</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea id={id} name={name} rows={rows ?? 3} required={required} defaultValue={defaultValue ?? ""} placeholder={placeholder} className="input py-2" disabled={disabled} />
      ) : (
        <input id={id} name={name} type={type} required={required} defaultValue={defaultValue ?? undefined} placeholder={placeholder} step={step} min={min} max={max} className="input" disabled={disabled} inputMode={type === "number" ? "decimal" : undefined} />
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
export const Grid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) => <div className={`grid gap-3 ${cols === 1 ? "" : cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"}`}>{children}</div>;
export const Hidden = ({ name, value }: { name: string; value: string | number }) => <input type="hidden" name={name} value={value} />;

export type Col<T> = { h: string; r: (row: T) => ReactNode; num?: boolean; hideSm?: boolean };
export function DataTable<T>({ cols, rows, empty, caption }: { cols: Col<T>[]; rows: T[]; empty?: ReactNode; caption?: string }) {
  if (!rows.length) return <Empty>{empty ?? "Nothing here yet."}</Empty>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[560px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-line bg-canvas"><tr>{cols.map((c, i) => <th key={i} scope="col" className={`th ${c.num ? "text-right" : ""} ${c.hideSm ? "hidden md:table-cell" : ""}`}>{c.h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{rows.map((row, i) => <tr key={i} className="hover:bg-canvas">{cols.map((c, j) => <td key={j} className={`td ${c.num ? "num" : ""} ${c.hideSm ? "hidden md:table-cell" : ""}`}>{c.r(row)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
export const Empty = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-muted"><p className="max-w-md">{children}</p>{action}</div>
);
export const Stat = ({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: string }) => {
  const inner = <div className="card p-4"><div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div><div className={`mt-1 text-2xl font-semibold num !text-left ${tone ?? ""}`}>{value}</div></div>;
  return href ? <Link href={href} className="block hover:shadow-sm">{inner}</Link> : inner;
};
export const A = ({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) => <Link href={href} className={`font-medium text-brand underline-offset-2 hover:underline ${className}`}>{children}</Link>;
export const LinkBtn = ({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) => <Link href={href} className={primary ? "btn-primary" : "btn-secondary"}>{children}</Link>;
export function Pager({ page, total, per, base }: { page: number; total: number; per: number; base: string }) {
  const pages = Math.max(1, Math.ceil(total / per)); if (pages <= 1) return null;
  const sep = base.includes("?") ? "&" : "?";
  return <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm"><span className="text-muted">Page {page} of {pages} · {total} records</span>
    <span className="flex gap-2">{page > 1 && <Link className="btn-secondary btn-sm" href={`${base}${sep}page=${page - 1}`}>← Previous</Link>}{page < pages && <Link className="btn-secondary btn-sm" href={`${base}${sep}page=${page + 1}`}>Next →</Link>}</span></nav>;
}
export function Filters({ q, children, action }: { q?: string; children?: ReactNode; action: string }) {
  return <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-2"><div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={q ?? ""} className="input w-56" placeholder="Search…" /></div>{children}<button className="btn-secondary">Apply</button><Link href={action} className="btn-secondary">Clear</Link></form>;
}
export const Note = ({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) => <div role={tone === "danger" ? "alert" : "note"} className={`mb-4 rounded-md px-4 py-3 text-sm ${TONE[tone]}`}>{children}</div>;
export const fmt = (n: number | string, d = 2) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: d });
export const date = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const dt = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
