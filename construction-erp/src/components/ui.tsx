import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatINR } from '@/lib/rules/money';

export function PageHeader({ title, sub, actions, crumbs }: { title: string; sub?: ReactNode; actions?: ReactNode; crumbs?: { href?: string; label: string }[] }) {
  return (
    <header className="mb-6">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="text-sm text-muted mb-2">
          <ol className="flex flex-wrap gap-1">
            {crumbs.map((c, i) => (
              <li key={i} className="flex gap-1">{c.href ? <Link href={c.href} className="text-muted underline-offset-2 hover:underline">{c.label}</Link> : <span aria-current="page">{c.label}</span>}{i < crumbs.length - 1 && <span aria-hidden>/</span>}</li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1>{title}</h1>{sub && <p className="text-muted mt-1">{sub}</p>}</div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 md:p-5 ${className}`}>
      {(title || actions) && <div className="flex flex-wrap items-center justify-between gap-2 mb-3">{title && <h2>{title}</h2>}{actions}</div>}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  neutral: 'bg-bg text-ink border-line', ok: 'bg-ok-soft text-ok border-[#b9dcc5]', warn: 'bg-warn-soft text-warn border-[#ecd48f]',
  bad: 'bg-bad-soft text-bad border-[#efc0c0]', info: 'bg-accent-soft text-accent border-[#c3d3e6]',
};
export function toneFor(status: string): keyof typeof TONES {
  if (['approved', 'verified', 'passed', 'paid', 'active', 'closed', 'certified', 'achieved', 'received', 'done', 'resolved', 'settled', 'sent', 'complete', 'agreed', 'mobilised'].includes(status)) return 'ok';
  if (['rejected', 'failed', 'disputed', 'cancelled', 'suspended', 'expired', 'past_due', 'blocked', 'critical', 'written_off'].includes(status)) return 'bad';
  if (['submitted', 'prepared', 'requested', 'in_review', 'open', 'issued', 'part_paid', 'part_received', 'correction_requested', 'in_transit', 'action_assigned', 'trialing', 'pending', 'in_progress', 'rectified', 'queued', 'running', 'reviewed'].includes(status)) return 'warn';
  if (['invoiced', 'ordered', 'billed', 'handover', 'defect_period'].includes(status)) return 'info';
  return 'neutral';
}
/** Status is always colour + text, never colour alone. */
export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${TONES[toneFor(status)]}`}>{label ?? status.replace(/_/g, ' ')}</span>;
}
export const Money = ({ v, className = '' }: { v: bigint | string | number | null | undefined; className?: string }) => <span className={`num ${className}`}>{v === null || v === undefined ? '—' : formatINR(v)}</span>;

export function Alert({ kind = 'info', children, title }: { kind?: 'info' | 'ok' | 'warn' | 'bad'; children: ReactNode; title?: string }) {
  const c = { info: 'bg-accent-soft border-[#c3d3e6]', ok: 'bg-ok-soft border-[#b9dcc5]', warn: 'bg-warn-soft border-[#ecd48f]', bad: 'bg-bad-soft border-[#efc0c0]' }[kind];
  return <div role={kind === 'bad' ? 'alert' : 'status'} className={`rounded border px-4 py-3 text-sm ${c}`}>{title && <strong className="block">{title}</strong>}{children}</div>;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="text-center py-10 px-4"><p className="font-semibold">{title}</p>{children && <p className="text-muted mt-1 max-w-md mx-auto">{children}</p>}{action && <div className="mt-4">{action}</div>}</div>;
}

export function Table({ head, children, empty }: { head: { label: string; num?: boolean; hideSm?: boolean }[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="overflow-x-auto border border-line rounded-lg bg-surface">
      <table className="w-full text-sm">
        <thead><tr>{head.map((h, i) => <th key={i} scope="col" className={`th ${h.num ? 'text-right' : ''} ${h.hideSm ? 'hidden md:table-cell' : ''}`}>{h.label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {!hasRows && (empty ?? <Empty title="Nothing here yet" />)}
    </div>
  );
}
export const Td = ({ children, num, hideSm, className = '' }: { children?: ReactNode; num?: boolean; hideSm?: boolean; className?: string }) =>
  <td className={`td ${num ? 'num' : ''} ${hideSm ? 'hidden md:table-cell' : ''} ${className}`}>{children}</td>;

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return <div className="card p-4"><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className={`text-xl font-semibold mt-1 num !text-left ${tone ?? ''}`}>{value}</p>{sub && <p className="text-xs text-muted mt-1">{sub}</p>}</div>;
}

export function Pager({ page, pages, base }: { page: number; pages: number; base: string }) {
  if (pages <= 1) return null;
  const href = (p: number) => `${base}${base.includes('?') ? '&' : '?'}page=${p}`;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between mt-3 text-sm">
      <span className="text-muted">Page {page} of {pages}</span>
      <span className="flex gap-2">
        {page > 1 && <Link className="btn btn-sm" href={href(page - 1)}>Previous</Link>}
        {page < pages && <Link className="btn btn-sm" href={href(page + 1)}>Next</Link>}
      </span>
    </nav>
  );
}

export function Field({ label, name, help, error, children, required }: { label: string; name: string; help?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <label htmlFor={name} className="label">{label}{required && <span aria-hidden className="text-bad"> *</span>}</label>
      {children}
      {help && <p className="help" id={`${name}-help`}>{help}</p>}
      {error && <p className="text-xs text-bad mt-1" role="alert">{error}</p>}
    </div>
  );
}
export const DL = ({ items }: { items: [string, ReactNode][] }) => (
  <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">{items.map(([k, v]) => <div key={k}><dt className="text-muted text-xs uppercase tracking-wide">{k}</dt><dd className="mt-0.5">{v ?? '—'}</dd></div>)}</dl>
);
export const fmtDate = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export const fmtDateTime = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
