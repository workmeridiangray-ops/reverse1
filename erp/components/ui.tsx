import Link from "next/link";
import type { ReactNode } from "react";

const TONE: Record<string, string> = {
  active: "ok", posted: "ok", paid: "ok", approved: "ok", received: "ok", fulfilled: "ok", delivered: "ok", accepted: "ok", closed: "info", confirmed: "info", done: "ok", succeeded: "ok", in_service: "ok", open_ok: "ok",
  draft: "", pending: "warn", pending_approval: "warn", partially_paid: "warn", partially_received: "warn", partially_fulfilled: "warn", sent: "info", acknowledged: "info", requested: "warn", in_transit: "info", trialing: "info", queued: "", running: "info",
  credit_hold: "bad", rejected: "bad", cancelled: "bad", void: "bad", failed: "bad", dead: "bad", exception: "bad", past_due: "bad", suspended: "bad", expired: "bad", reversed: "warn", superseded: "", retired: "", refunded: "warn", disputed: "bad", under_repair: "warn", disposal_pending: "warn", exited: "",
  converted: "info", inspected: "info", open: "warn", matched: "ok", unmatched: "", exception_approved: "warn", submitted: "warn",
};
export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${TONE[status] ?? ""}`}>{label ?? status.replace(/_/g, " ")}</span>;
}
export function PageHead({ title, crumbs, children, sub }: { title: string; crumbs?: [string, string?][]; children?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pagehead">
      <div>
        {crumbs && <nav className="crumbs" aria-label="Breadcrumb">{crumbs.map(([l, h], i) => <span key={i}>{i > 0 && " / "}{h ? <Link href={h}>{l}</Link> : l}</span>)}</nav>}
        <h1>{title}</h1>{sub && <div className="muted">{sub}</div>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
export function Alert({ tone = "info", children }: { tone?: "ok" | "bad" | "warn" | "info"; children: ReactNode }) {
  return <div className={`alert ${tone}`} role={tone === "bad" ? "alert" : "status"}>{children}</div>;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="kpi"><div className="l">{label}</div><div className="v">{value}</div>{hint && <div className="small muted">{hint}</div>}</div>;
}
export function Pager({ page, pages, total, params, base }: { page: number; pages: number; total: number; params: Record<string, string | undefined>; base: string }) {
  const href = (p: number) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ ...params, page: String(p) })) if (v) u.set(k, v); return `${base}?${u}`; };
  return (
    <div className="pager"><span>{total} record{total === 1 ? "" : "s"} · page {page} of {Math.max(1, pages)}</span>
      <span className="row">{page > 1 ? <Link className="btn sm" href={href(page - 1)}>Previous</Link> : <span className="btn sm" aria-disabled="true">Previous</span>}
        {page < pages ? <Link className="btn sm" href={href(page + 1)}>Next</Link> : <span className="btn sm" aria-disabled="true">Next</span>}</span></div>
  );
}
export function Tabs({ items, current }: { items: [string, string][]; current: string }) {
  return <nav className="tabs" aria-label="Sections">{items.map(([l, h]) => <Link key={h} href={h} aria-current={h === current ? "page" : undefined}>{l}</Link>)}</nav>;
}
export function Money({ v }: { v: number | string | null | undefined }) { return <span className="num">{fmt(v)}</span>; }
import { formatMoney } from "@/lib/money";
const fmt = formatMoney;
