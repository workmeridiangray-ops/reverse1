import Link from "next/link";
import { requirePlatform } from "@/lib/server/auth";
import { logoutAction } from "@/app/(auth)/actions";
export const dynamic = "force-dynamic";
const nav: [string, string][] = [["/admin", "Overview"], ["/admin/businesses", "Businesses"], ["/admin/billing", "Plans, invoices & coupons"], ["/admin/operations", "Jobs, webhooks & email"], ["/admin/support", "Support & leads"], ["/admin/audit", "Audit log"], ["/admin/staff", "Staff & announcements"]];
export default async function L({ children }: { children: React.ReactNode }) {
  const a = await requirePlatform();
  return <div className="min-h-screen lg:grid lg:grid-cols-[230px_1fr]"><aside className="border-b border-line bg-[#17212F] p-3 text-white lg:border-b-0"><div className="px-2 pb-2 font-semibold">Forgeline · Platform</div><div className="px-2 pb-3 text-xs text-white/70">{a.user.email} · {a.user.platformRole}</div>
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto lg:flex-col">{nav.map(([h, t]) => <Link key={h} href={h} className="whitespace-nowrap rounded px-2 py-2 text-sm hover:bg-white/10">{t}</Link>)}</nav>
    <form action={logoutAction} className="mt-3 px-2"><button className="text-sm underline">Sign out</button></form></aside><main id="main">{children}</main></div>;
}
