import Link from "next/link";
import { requirePlatform } from "@/lib/auth/session";
import { logoutAction } from "@/lib/auth/actions";
export const dynamic = "force-dynamic";
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const c = await requirePlatform();
  const L: [string, string][] = [["Overview", "/platform"], ["Businesses", "/platform/businesses"], ["Plans & versions", "/platform/plans"], ["Payments & invoices", "/platform/payments"], ["Jobs & failures", "/platform/jobs"], ["Demo & contact requests", "/platform/requests"], ["Coupons", "/platform/coupons"], ["Announcements", "/platform/announcements"], ["Platform staff", "/platform/staff"], ["Audit log", "/platform/audit"]];
  return (<div className="shell"><aside className="side"><Link href="/platform" className="brand"><i />Platform</Link><nav className="nav" aria-label="Platform">{L.map(([l, h]) => <Link key={h} href={h}>{l}</Link>)}</nav></aside>
    <div className="main"><header className="topbar"><span className="ws">Platform console</span><span className="ctxchip">{c.user.platformRole}</span><span style={{ flex: 1 }} /><Link className="btn sm" href="/workspaces">Companies</Link><Link className="btn sm" href="/account">Security</Link><form action={logoutAction}><button className="btn sm">Sign out</button></form></header><div className="content">{children}</div></div></div>);
}
