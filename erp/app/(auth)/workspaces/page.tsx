import { redirect } from "next/navigation";
import Link from "next/link";
import { withSystem } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/lib/auth/actions";
import { WorkspaceList } from "./WorkspaceList";
import { Alert } from "@/components/ui";
export const metadata = { title: "Choose a company" };
export const dynamic = "force-dynamic";
export default async function Workspaces() {
  const ctx = await requireUser();
  if (ctx.user.totpEnabled && !ctx.mfaOk) redirect("/login/2fa");
  const ws = await withSystem(async (db) => (await db.query(
    `select t.id, t.name, t.status, r.name role, m.customer_id from memberships m join tenants t on t.id=m.tenant_id join roles r on r.id=m.role_id where m.user_id=$1 and m.status='active' and t.status <> 'closed' order by t.name`, [ctx.user.id])).rows);
  if (ws.length === 1 && !ctx.user.platformRole) {
    // a single company: open it directly
    return <WorkspaceList items={[{ id: ws[0].id, name: ws[0].name, role: ws[0].role, status: ws[0].status, customer: !!ws[0].customer_id }]} />;
  }
  return (
    <div className="card"><h1>Choose a company</h1>
      <p className="muted">Signed in as {ctx.user.email}. Each company’s data is separate; you can switch at any time from the top bar.</p>
      {ctx.user.platformRole && <p><Link className="btn" href="/platform">Open platform console</Link></p>}
      {ws.length === 0 ? <Alert tone="warn">You are not a member of any company yet. Accept an invitation or <Link href="/signup">create a company</Link>.</Alert>
        : <WorkspaceList items={ws.map((w: any) => ({ id: w.id, name: w.name, role: w.role, status: w.status, customer: !!w.customer_id }))} />}
      <form action={logoutAction} style={{ marginTop: 16 }}><button className="btn sm ghost">Sign out</button></form>
    </div>
  );
}
