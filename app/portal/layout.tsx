import Link from "next/link";
import { requireCompany } from "@/lib/server/auth";
import { isPortal } from "@/lib/server/perms";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/(auth)/actions";
export const dynamic = "force-dynamic";
export default async function L({ children }: { children: React.ReactNode }) {
  const a = await requireCompany(); if (!isPortal(a.membership.role)) redirect("/app");
  return <div className="min-h-screen"><header className="border-b border-line bg-surface"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3"><div><div className="font-semibold">{a.company.name}</div><div className="text-xs text-muted">{a.membership.role === "customer" ? "Customer portal" : "Supplier portal"} · {a.user.email}</div></div>
    <nav className="flex items-center gap-3 text-sm"><Link href="/portal" className="text-brand">Overview</Link><Link href="/workspaces" className="text-brand">Switch</Link><form action={logoutAction}><button className="text-brand underline">Sign out</button></form></nav></div></header><main id="main">{children}</main></div>;
}
