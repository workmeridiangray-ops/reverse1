import { notFound } from "next/navigation";
import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { suspendAction, unsuspendAction, extendTrialAction, creditAction, supportRequestAction, closeTenantAction } from "../../actions";
import { usage } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
export default async function Business({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound(); const c = await requirePlatform(); const role = c.user.platformRole!; const can = (...r: string[]) => role === "owner" || r.includes(role);
  const d = await withSystem(async (db) => { const t = (await db.query("select * from tenants where id=$1", [id])).rows[0]; if (!t) return null;
    return { t, use: await usage(db, id), sub: (await db.query("select s.*, p.name plan, pv.version from subscriptions s join plan_versions pv on pv.id=s.plan_version_id join plans p on p.id=pv.plan_id where s.tenant_id=$1 order by s.created_at desc limit 1", [id])).rows[0],
      inv: (await db.query("select * from platform_invoices where tenant_id=$1 order by created_at desc limit 8", [id])).rows, sup: (await db.query("select * from support_access where tenant_id=$1 order by created_at desc limit 5", [id])).rows, owners: (await db.query("select u.name, u.email from memberships m join roles r on r.id=m.role_id join users u on u.id=m.user_id where m.tenant_id=$1 and r.key='owner' and m.status='active'", [id])).rows, closure: (await db.query("select * from closure_requests where tenant_id=$1 and status='requested'", [id])).rows[0] }; });
  if (!d) notFound(); const { t } = d;
  return (<><PageHead title={t.name} crumbs={[["Businesses", "/platform/businesses"], [t.name]]} sub={<Badge status={t.status} />} />
    <div className="card"><dl className="kv"><dt>Owners</dt><dd>{d.owners.map((o: any) => `${o.name} <${o.email}>`).join(", ")}</dd><dt>Plan</dt><dd>{d.sub ? `${d.sub.plan} v${d.sub.version} · ${d.sub.status} · ${d.sub.billing_interval} · period ends ${new Date(d.sub.current_period_end).toLocaleDateString("en-IN")}` : "none"}</dd><dt>Usage</dt><dd>{d.use.users} users · {d.use.branches} branches · {d.use.storageMb} MB</dd>{t.suspended_reason && <><dt>Suspended because</dt><dd>{t.suspended_reason}</dd></>}</dl>
      <p className="small muted">Customer business records are not shown here. Support can read them only after the company owner approves a time-limited request.</p></div>
    {d.closure && <Alert tone="warn">Closure requested on {new Date(d.closure.created_at).toDateString()}: {d.closure.reason ?? "no reason given"}. {can() ? "Confirm below after the final export." : ""}</Alert>}
    <div className="card"><h2>Invoices</h2>{d.inv.map((i: any) => <p key={i.id}>{i.number} · {i.description} · {formatMoney(i.total_paise)} · <Badge status={i.status} /></p>)}</div>
    <div className="grid g2">
      {can("support") && (t.status === "suspended" ? <div className="card"><h3>Restore access</h3><ActionForm action={unsuspendAction.bind(null, id)} submit="Restore"><Field name="reason" label="Reason" required /></ActionForm></div> : <div className="card"><h3>Suspend</h3><ActionForm action={suspendAction.bind(null, id)} submit="Suspend company" danger confirm="Suspend and sign everyone out?"><Field name="reason" label="Reason (recorded)" required /></ActionForm></div>)}
      {can("billing", "support") && <div className="card"><h3>Extend trial</h3><ActionForm action={extendTrialAction.bind(null, id)} submit="Extend"><div className="grid g2"><Field name="days" label="Days" defaultValue="7" /><Field name="reason" label="Reason" required /></div></ActionForm></div>}
      {can("billing") && <div className="card"><h3>Account credit</h3><ActionForm action={creditAction.bind(null, id)} submit="Grant credit"><div className="grid g2"><Field name="amount" label="Amount ₹" /><Field name="reason" label="Reason" required /></div></ActionForm></div>}
      {can("support") && <div className="card"><h3>Request support access</h3><p className="small muted">The owner approves a read-only, time-limited window.</p><ActionForm action={supportRequestAction.bind(null, id)} submit="Send request"><Field name="reason" label="Why (ticket/issue)" required /></ActionForm>{d.sup.map((s: any) => <p key={s.id} className="small">{s.reason} <Badge status={s.status} /></p>)}</div>}
      {can() && t.status !== "closed" && <div className="card"><h3>Close company</h3><ActionForm action={closeTenantAction.bind(null, id)} submit="Close company" danger confirm="Close this company permanently?"><Field name="confirm" label="Type CLOSE" required /></ActionForm></div>}</div></>);
}
