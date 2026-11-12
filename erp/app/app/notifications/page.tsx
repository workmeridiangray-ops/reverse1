import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Empty } from "@/components/ui";
import { StatusButton } from "@/components/StatusButton";
import { markAllReadAction } from "./actions";
export default async function Notifications() {
  const ctx = await requireTenant();
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select * from notifications where tenant_id=$1 and user_id=$2 order by created_at desc limit 50", [ctx.tenant.id, ctx.user.id])).rows);
  return (<><PageHead title="Notifications" crumbs={[["Notifications"]]}>{rows.some((r: any) => !r.read_at) && <StatusButton action={markAllReadAction} label="Mark all read" />}</PageHead>
    <div className="card">{rows.length === 0 ? <Empty title="No notifications">Approvals and company alerts will appear here.</Empty> : rows.map((n: any) => <p key={n.id} style={{ fontWeight: n.read_at ? 400 : 650 }}>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title} <span className="muted small">· {new Date(n.created_at).toLocaleString("en-IN")}</span>{n.body && <><br /><span className="muted small">{n.body}</span></>}</p>)}</div></>);
}
