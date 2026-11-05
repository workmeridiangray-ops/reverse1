import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Alert } from "@/components/ui/Layout";
import { PRODUCT_NAME } from "@/lib/brand";
import { ROLE_LABEL } from "@/lib/rules/permissions";
import type { Ctx } from "@/lib/server/auth";
import { signOut } from "@/app/(auth)/actions";

export function AppShell({ c, children }: { c: Ctx; children: ReactNode }) {
  const nav: Array<[string, string, boolean]> = [
    ["Dashboard", "/app", true],
    ["Projects", "/app/projects", c.can("project.view")],
    ["Suppliers", "/app/suppliers", c.can("supplier.view")],
    ["Team", "/app/team", c.can("team.view") || c.role === "owner"],
    ["Audit trail", "/app/audit", c.can("audit.view")],
    ["Settings", "/app/settings", c.role === "owner"],
    ["My account", "/app/account", true],
  ];
  const trialDays = c.tenant.status === "trial" && c.tenant.trialEndsAt ? Math.ceil((c.tenant.trialEndsAt.getTime() - Date.now()) / 86400000) : null;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="border-b border-line bg-surface lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3 lg:block">
          <div>
            <Link href="/app" className="text-title font-bold text-ink-900 no-underline">{PRODUCT_NAME}</Link>
            <p className="text-sm font-bold text-ink-900" data-testid="workspace-name">{c.tenant.name}</p>
            <p className="text-caption text-ink-500">{ROLE_LABEL[c.role]}</p>
          </div>
        </div>
        <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:block lg:overflow-visible lg:pb-0">
          {nav.filter((n) => n[2]).map(([l, h]) => (
            <Link key={h} href={h} className="flex min-h-touch items-center whitespace-nowrap rounded px-3 font-bold text-ink-700 no-underline hover:bg-brand-50 hover:text-brand-700">{l}</Link>
          ))}
        </nav>
        <div className="hidden space-y-1 border-t border-line p-3 lg:block">
          <Link href="/workspaces" className="flex min-h-touch items-center gap-2 rounded px-3 text-sm no-underline hover:bg-brand-50"><Icon name="building" /> Switch workspace</Link>
          <form action={signOut}><Button type="submit" variant="ghost" size="sm" icon="logout" className="w-full justify-start">Sign out</Button></form>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="space-y-2 px-4 pt-4 lg:px-8">
          {c.tenant.lockReason ? <Alert tone="danger" title="Workspace is read-only">{c.tenant.lockReason} <Link href="/app/settings">Open settings</Link></Alert> : null}
          {trialDays !== null && trialDays >= 0 ? <Alert tone="info">Trial: {trialDays} day(s) left. <Link href="/app/settings">Choose a plan</Link></Alert> : null}
          {!c.user.verified ? <Alert tone="warn">Verify your email address using the link we sent you.</Alert> : null}
        </div>
        <main id="main" className="mx-auto max-w-page px-4 py-6 lg:px-8">{children}</main>
        <div className="border-t border-line p-3 lg:hidden"><form action={signOut}><Button type="submit" variant="ghost" size="sm" icon="logout">Sign out</Button></form></div>
      </div>
    </div>
  );
}
