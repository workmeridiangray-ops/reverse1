import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { logoutAction } from "@/lib/auth/actions";
export const dynamic = "force-dynamic";
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  if (!ctx.membership.customerId || !ctx.perms.has("portal.view")) redirect("/app");
  return (<><header className="site-head"><span className="brand" style={{ padding: 0 }}><i />{ctx.tenant.name}</span><nav><Link href="/portal">Orders</Link><Link href="/portal/invoices">Invoices</Link></nav><div className="row"><span className="muted small">{ctx.user.email}</span><form action={logoutAction}><button className="btn sm">Sign out</button></form></div></header><main id="main" className="wrap section">{children}</main></>);
}
