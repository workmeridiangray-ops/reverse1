import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { MenuButton, NavCloser } from "@/components/MenuButton";
import { NavLinks, type NavGroup } from "@/components/NavLinks";
import { logoutAction } from "@/lib/auth/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  if (ctx.membership.customerId) redirect("/portal");
  const p = ctx.perms;
  const G: NavGroup[] = [
    { title: "", links: [["Dashboard", "/app"], ...(p.has("approvals.decide") ? [["Approvals", "/app/approvals"] as [string, string]] : [])] },
    ...(p.has("sales.view") ? [{ title: "Sales", links: [["Quotations", "/app/sales/quotes"], ["Sales orders", "/app/sales/orders"], ["Shortages", "/app/sales/shortages"], ["Dispatches", "/app/fulfilment/dispatches"], ["Customer returns", "/app/fulfilment/returns"]] as [string, string][] }] : []),
    ...(p.has("procurement.view") ? [{ title: "Purchasing", links: [["Purchase requests", "/app/procurement/requests"], ["Purchase orders", "/app/procurement/orders"], ["Supplier bills", "/app/procurement/bills"], ["Supplier performance", "/app/procurement/performance"]] as [string, string][] }] : []),
    ...(p.has("inventory.view") ? [{ title: "Inventory", links: [["Stock", "/app/inventory"], ["Item ledger", "/app/inventory/ledger"], ["Transfers", "/app/inventory/transfers"], ["Counts & adjustments", "/app/inventory/counts"], ["Reorder", "/app/inventory/reorder"], ["Barcode labels", "/app/inventory/labels"]] as [string, string][] }] : []),
    ...(p.has("finance.view") ? [{ title: "Finance", links: [["Invoices", "/app/finance/invoices"], ["Receipts", "/app/finance/receipts"], ["Expenses", "/app/finance/expenses"], ["Journals", "/app/finance/journals"], ["Chart of accounts", "/app/finance/accounts"], ["Trial balance", "/app/finance/trial-balance"], ["Profit & loss", "/app/finance/pnl"], ["Balance sheet", "/app/finance/balance-sheet"], ["Periods", "/app/finance/periods"], ["Reconciliation", "/app/finance/reconciliation"]] as [string, string][] }] : []),
    ...(p.has("projects.view") || p.has("hr.view") || p.has("assets.view") ? [{ title: "Operations", links: [...(p.has("projects.view") ? [["Projects", "/app/projects"]] : []), ...(p.has("hr.view") ? [["People", "/app/people"], ["Leave requests", "/app/people/leave"]] : []), ...(p.has("assets.view") ? [["Assets", "/app/assets"]] : [])] as [string, string][] }] : []),
    ...(p.has("reports.view") ? [{ title: "Reports", links: [["Report library", "/app/reports"]] as [string, string][] }] : []),
    ...(p.has("masters.view") ? [{ title: "Master data", links: [["Customers", "/app/masters/customers"], ["Suppliers", "/app/masters/suppliers"], ["Items & services", "/app/masters/items"], ["Branches", "/app/masters/branches"], ["Warehouses", "/app/masters/warehouses"], ["Departments", "/app/masters/departments"], ["Tax codes", "/app/masters/tax_codes"], ["Price lists", "/app/masters/price_lists"], ["Import (CSV)", "/app/import"]] as [string, string][] }] : []),
    { title: "Company", links: [...(p.has("users.manage") ? [["Team & invitations", "/app/settings/team"]] : []), ...(p.has("roles.manage") ? [["Roles & permissions", "/app/settings/roles"]] : []),
      ...(p.has("settings.manage") ? [["Business settings", "/app/settings/business"], ["Integrations & API", "/app/settings/integrations"]] : []), ...(p.has("config.manage") ? [["Approval & config studio", "/app/settings/studio"]] : []),
      ...(p.has("billing.manage") ? [["Plan & billing", "/app/settings/billing"]] : []), ...(p.has("audit.view") ? [["Audit trail", "/app/settings/audit"]] : []), ...(p.has("data.export") ? [["Data & closure", "/app/settings/data"]] : []),
      ["Setup checklist", "/app/welcome"], ["Extensions", "/app/extensions"]] as [string, string][] },
  ];
  const { unread, branches, trialDays } = await withTenantSystem(ctx.tenant.id, async (db) => {
    const unread = Number((await db.query("select count(*) c from notifications where user_id=$1 and read_at is null", [ctx.user.id])).rows[0].c);
    const branches = (await db.query("select id, name from branches where tenant_id=$1 and status='active' order by name", [ctx.tenant.id])).rows;
    const trial = ctx.tenant.status === "trial" && ctx.tenant.trialEndsAt ? Math.ceil((new Date(ctx.tenant.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
    return { unread, branches, trialDays: trial };
  });
  const scope = ctx.membership.branchIds;
  const visible = scope ? branches.filter((b: any) => scope.includes(b.id)) : branches;
  return (
    <div className="shell">
      <aside className="side" aria-label="Primary">
        <div className="row between"><Link href="/app" className="brand"><i />Ledgerline</Link><NavCloser /></div>
        <NavLinks groups={G} />
      </aside>
      <div className="main">
        {ctx.readOnlyReason && <div className="banner bad" role="alert">{ctx.readOnlyReason} {p.has("billing.manage") && <Link href="/app/settings/billing">Go to billing</Link>}</div>}
        {!ctx.readOnlyReason && trialDays !== null && trialDays <= 7 && <div className="banner" role="status">Your free trial ends in {Math.max(0, trialDays)} day(s). {p.has("billing.manage") && <Link href="/app/settings/billing">Choose a plan</Link>}</div>}
        <header className="topbar">
          <MenuButton />
          <div><span className="ws">{ctx.tenant.name}</span> <Link className="small" href="/workspaces">Switch company</Link></div>
          <span className="ctxchip" title="Branch access">{scope ? (visible.length === 1 ? visible[0].name : `${visible.length} branches`) : "All branches"}</span>
          <form className="search" action="/app/search" role="search"><label className="sr-only" htmlFor="gs">Search</label><input id="gs" name="q" placeholder="Search customers, items, documents…" /></form>
          <span style={{ flex: 1 }} />
          <Link className="btn sm" href="/app/notifications" aria-label={`Notifications, ${unread} unread`}>🔔 {unread > 0 && <strong>{unread}</strong>}</Link>
          <details style={{ position: "relative" }}><summary className="btn sm" style={{ listStyle: "none" }}>{ctx.user.name} ▾</summary>
            <div className="card" style={{ position: "absolute", right: 0, top: 44, minWidth: 220, zIndex: 40 }}>
              <p className="small muted">{ctx.user.email}<br />{ctx.membership.roleName}</p>
              <p><Link href="/app/profile">Profile & security</Link></p>
              <p><Link href="/help">Help</Link></p>
              <form action={logoutAction}><button className="btn sm">Sign out</button></form></div></details>
        </header>
        <div className="content" id="content">{children}</div>
      </div>
    </div>
  );
}
