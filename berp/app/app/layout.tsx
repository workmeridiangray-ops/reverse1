import Link from "next/link";
import { requireCtx, type Role } from "@/lib/session";
import { signOut } from "../(auth)/actions";

const NAV: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/app", label: "Overview" },
  { href: "/app/approvals", label: "Approvals", roles: ["owner", "manager", "sales", "purchasing"] },
  { href: "/app/sales", label: "Sales orders" },
  { href: "/app/purchasing", label: "Purchasing" },
  { href: "/app/inventory", label: "Inventory" },
  { href: "/app/invoices", label: "Invoices & receipts", roles: ["owner", "manager", "accountant", "viewer", "sales"] },
  { href: "/app/finance", label: "Finance", roles: ["owner", "manager", "accountant", "viewer"] },
  { href: "/app/reports", label: "Reports", roles: ["owner", "manager", "accountant", "viewer"] },
  { href: "/app/projects", label: "Projects" },
  { href: "/app/people", label: "People" },
  { href: "/app/assets", label: "Assets" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/suppliers", label: "Suppliers" },
  { href: "/app/items", label: "Items" },
  { href: "/app/import", label: "Import", roles: ["owner", "manager"] },
  { href: "/app/settings", label: "Settings", roles: ["owner", "manager"] },
  { href: "/app/help", label: "Help" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const t = ctx.tenant;
  const daysLeft = Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 86400000);
  const banner = t.status === "suspended" ? "This workspace is suspended. Data is read-only; contact support."
    : t.status === "past_due" ? "Payment failed. Update billing to avoid suspension."
    : t.status === "trial" ? (daysLeft > 0 ? `Trial: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.` : "Trial expired. Data is read-only until you choose a plan.") : null;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-surface md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:block">
          <Link href="/app" className="text-lg font-semibold tracking-tight">BERP</Link>
          <form action={signOut} className="md:hidden"><button className="btn min-h-0 px-3 py-1 text-sm" type="submit">Sign out</button></form>
          <div className="md:mt-3">
            <p className="truncate text-sm font-semibold" title={t.name}>{t.name}</p>
            <p className="text-xs text-muted">{ctx.role} · {t.plan_code}{ctx.workspaces.length > 1 && <> · <Link className="underline" href="/workspaces">switch</Link></>}</p>
          </div>
        </div>
        <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:space-y-0.5 md:px-3">
          {NAV.filter((n) => !n.roles || n.roles.includes(ctx.role)).map((n) => (
            <Link key={n.href} href={n.href} className="block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium hover:bg-canvas">{n.label}</Link>
          ))}
          {ctx.isPlatformAdmin && <Link href="/platform" className="block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium hover:bg-canvas">Platform admin</Link>}
        </nav>
        <form action={signOut} className="hidden px-4 pb-4 pt-2 md:block"><p className="mb-2 truncate text-xs text-muted">{ctx.email}</p><button className="btn w-full" type="submit">Sign out</button></form>
      </aside>
      <div className="min-w-0">
        {banner && <div role="status" className="border-b border-line bg-warn-bg px-4 py-2 text-sm text-warn">{banner} {ctx.role === "owner" && <Link className="underline" href="/app/settings">Choose a plan</Link>}</div>}
        <main id="main" className="mx-auto max-w-page p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
