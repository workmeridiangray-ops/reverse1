import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-section flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="text-sm font-bold uppercase tracking-wide text-brand-700">{eyebrow}</p> : null}
        <h1 className="text-display font-bold text-ink-900">{title}</h1>
        {description ? <div className="mt-1 max-w-prose text-lg text-ink-700">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, actions, children, className = "", as: As = "section", titleId }: {
  title?: string; actions?: ReactNode; children: ReactNode; className?: string; as?: "section" | "div" | "aside"; titleId?: string;
}) {
  const id = titleId ?? (title ? `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined);
  return (
    <As aria-labelledby={title ? id : undefined} className={`min-w-0 rounded-lg border border-line bg-surface shadow-card ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          {title ? <h2 id={id} className="text-title font-bold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className="p-6">{children}</div>
    </As>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "danger" | "warn" | "ok"; title?: string; children?: ReactNode }) {
  const styles = {
    info: "bg-info-bg text-info-fg border-info-line",
    danger: "bg-danger-bg text-danger-fg border-danger-line",
    warn: "bg-warn-bg text-warn-fg border-warn-line",
    ok: "bg-ok-bg text-ok-fg border-ok-line",
  }[tone];
  const icon = tone === "ok" ? "check" : tone === "info" ? "dot" : "alert";
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-3 rounded border px-4 py-3 ${styles}`}>
      <Icon name={icon} className="mt-1 h-4 w-4" />
      <div>
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className="text-sm">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-line-strong bg-canvas px-6 py-10 text-center">
      <p className="text-lg font-bold text-ink-700">{title}</p>
      {children ? <div className="mt-2 text-ink-500">{children}</div> : null}
    </div>
  );
}

export function Notice({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-clay-100 bg-clay-50 px-6 py-5">
      <p className="text-sm font-bold uppercase tracking-wide text-clay-700">{phase}</p>
      <div className="mt-1 text-ink-700">{children}</div>
    </div>
  );
}

export function DefinitionList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-6 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-sm font-bold text-ink-500">{k}</dt>
          <dd className="min-w-0 break-words text-base text-ink-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
