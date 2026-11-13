import Link from "next/link";
import { logoutAction, switchWorkspaceAction } from "@/app/(auth)/actions";
import { can, type Perm, type Role, ROLE_LABEL } from "@/lib/server/perms";
import { plat } from "@/lib/server/db";
import type { CompanyAuth } from "@/lib/server/auth";

const NAV: { group: string; items: [string, string, Perm | null][] }[] = [
  { group: "Overview", items: [["/app", "Dashboard", null], ["/app/reports", "Reports", "report.read"]] },
  { group: "Masters", items: [["/app/items", "Items", "master.read"], ["/app/partners", "Customers & suppliers", "master.read"], ["/app/setup", "Plants & work centres", "master.read"]] },
  { group: "Engineering", items: [["/app/boms", "BOMs & routings", "master.read"], ["/app/changes", "Engineering changes", "master.read"]] },
  { group: "Sales", items: [["/app/sales", "Orders & quotes", "sales.read"], ["/app/forecasts", "Forecasts", "sales.read"]] },
  { group: "Planning", items: [["/app/planning", "MRP & suggestions", "plan.run"], ["/app/schedule", "Schedule & load", "prod.read"]] },
  { group: "Procurement", items: [["/app/purchasing", "Purchase orders", "proc.read"], ["/app/purchasing/requests", "Requests & RFQs", "proc.read"], ["/app/subcontract", "Subcontracting", "proc.read"]] },
  { group: "Inventory", items: [["/app/inventory", "Stock & movements", "inv.read"], ["/app/inventory/counts", "Count sheets", "inv.read"], ["/app/labels", "Barcode labels", "inv.read"], ["/app/trace", "Traceability & recall", "inv.read"]] },
  { group: "Production", items: [["/app/production", "Work orders", "prod.read"], ["/app/shopfloor", "Shop floor", "shop.operate"], ["/app/maintenance", "Maintenance & downtime", "prod.read"]] },
  { group: "Quality", items: [["/app/quality", "Inspections & NCRs", "qa.read"], ["/app/quality/plans", "Inspection plans", "qa.read"]] },
  { group: "Fulfilment", items: [["/app/shipping", "Dispatch & returns", "ship.read"]] },
  { group: "Finance", items: [["/app/costing", "Job costing", "cost.read"]] },
  { group: "Company", items: [["/app/settings", "Settings & team", "admin.users"], ["/app/audit", "Audit trail", "audit.read"], ["/app/support", "Help & support", null]] },
];
export async function AppShell({ auth, children }: { auth: CompanyAuth; children: React.ReactNode }) {
  const role = auth.membership.role as Role;
  const mems = (await plat("select c.id, c.name from memberships m join companies c on c.id=m.company_id where m.user_id=$1 and m.active order by c.name", [auth.user.id])).rows;
  const unread = (await plat("select count(*)::int n from notifications where user_id=$1 and read_at is null", [auth.user.id])).rows[0].n;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(([, , p]) => !p || can(role, p)) })).filter((g) => g.items.length);
  const sub = auth.company.status;
  const navEl = (<nav aria-label="Application" className="space-y-4 text-sm">{groups.map((g) => (
    <div key={g.group}><div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.group}</div>
      <ul className="mt-1">{g.items.map(([h, t]) => <li key={h}><Link href={h} className="flex min-h-[40px] items-center rounded-md px-2 hover:bg-sunken">{t}</Link></li>)}</ul></div>))}</nav>);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-line bg-surface p-3 lg:block"><Link href="/app" className="mb-4 block px-2 text-lg font-semibold text-brand">Forgeline</Link>{navEl}</aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <details className="relative lg:hidden"><summary className="btn-secondary btn-sm cursor-pointer list-none">☰ Menu</summary><div className="absolute left-0 top-11 max-h-[75vh] w-72 overflow-y-auto rounded-lg border border-line bg-surface p-3 shadow-lg">{navEl}</div></details>
          <div className="flex min-w-0 items-center gap-2"><span className="truncate font-medium" title="Workspace">{auth.company.name}</span>
            {auth.company.demo && <span className="rounded bg-[#FBF0D9] px-2 py-0.5 text-xs text-warn">DEMO DATA</span>}
            {sub !== "active" && <Link href="/app/settings/billing" className="rounded bg-[#FBF0D9] px-2 py-0.5 text-xs text-warn">{sub.replace("_", " ")}</Link>}</div>
          {mems.length > 1 && <form action={switchWorkspaceAction} className="flex items-center gap-1"><label className="sr-only" htmlFor="ws">Switch workspace</label>
            <select id="ws" name="company" defaultValue={auth.company.id} className="input !min-h-[36px] w-40 py-0 text-sm">{mems.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button className="btn-secondary btn-sm">Switch</button></form>}
          <form action="/app/search" className="ml-auto flex items-center gap-1"><label className="sr-only" htmlFor="gs">Search</label><input id="gs" name="q" placeholder="Search items, orders, batches…" className="input !min-h-[36px] w-44 py-0 text-sm sm:w-64" /></form>
          <Link href="/app/notifications" className="btn-secondary btn-sm" aria-label={`Notifications, ${unread} unread`}>🔔 {unread > 0 && <b>{unread}</b>}</Link>
          <details className="relative"><summary className="btn-secondary btn-sm cursor-pointer list-none">{auth.user.name.split(" ")[0]}</summary>
            <div className="absolute right-0 top-11 z-40 w-56 rounded-lg border border-line bg-surface p-2 text-sm shadow-lg"><div className="px-2 py-1 text-xs text-muted">{auth.user.email}<br />{ROLE_LABEL[role]}</div>
              <Link className="block rounded px-2 py-2 hover:bg-sunken" href="/app/profile">Profile & security</Link><Link className="block rounded px-2 py-2 hover:bg-sunken" href="/workspaces">Switch workspace</Link>
              <form action={logoutAction}><button className="w-full rounded px-2 py-2 text-left hover:bg-sunken">Sign out</button></form></div></details>
        </header>
        {!auth.user.verified && <div className="bg-[#FBF0D9] px-4 py-2 text-sm text-warn">Please verify your email. <Link className="underline" href="/app/profile">Resend the link</Link></div>}
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
