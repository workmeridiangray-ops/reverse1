import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { requestClosureAction, decideSupportAccessAction, revokeSupportAccessAction } from "../actions";
const EXPORTS = ["customers", "suppliers", "items", "stock", "stock-ledger", "orders", "invoices", "bills", "journals", "audit"];
export default async function DataPage() {
  const ctx = await requireTenant("data.export");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ sup: (await db.query("select s.*, u.name staff from support_access s join users u on u.id=s.staff_user_id where s.tenant_id=$1 order by s.created_at desc limit 10", [ctx.tenant.id])).rows, cl: (await db.query("select * from closure_requests where tenant_id=$1 order by created_at desc limit 3", [ctx.tenant.id])).rows }));
  return (<><PageHead title="Data, support access & closure" crumbs={[["Company"], ["Data"]]} />
    <div className="card"><h2>Export your data</h2><p className="muted small">CSV files, always available, including after cancellation. Each download is logged.</p><p>{EXPORTS.map((k) => <a key={k} className="btn sm" style={{ margin: 3 }} href={`/app/export/${k}`}>{k}</a>)}</p>
      <p className="small muted">Retention: backups are kept 35 days; after closure data is deleted after the contractual retention period unless law requires otherwise. Attachments are exported via the document pages.</p></div>
    <div className="card"><h2>Support access requests</h2><p className="muted small">Platform support can only look at your records after you approve, read-only, for a limited time. Everything they do is logged.</p>
      {d.sup.length === 0 ? <p className="muted">No requests.</p> : d.sup.map((s: any) => <div key={s.id}><p><strong>{s.staff}</strong> — “{s.reason}” <Badge status={s.status === "approved" && s.expires_at && new Date(s.expires_at) < new Date() ? "expired" : s.status} />{s.expires_at && s.status === "approved" && <span className="muted small"> until {new Date(s.expires_at).toLocaleString("en-IN")}</span>}</p>
        {s.status === "requested" && ctx.perms.has("settings.manage") && <div className="grid g2"><ActionForm action={decideSupportAccessAction.bind(null, s.id, true)} submit="Approve read-only access"><Field name="hours" label="Hours (1–72)" defaultValue="4" /></ActionForm><ActionForm action={decideSupportAccessAction.bind(null, s.id, false)} submit="Deny" danger><p className="muted small">No access will be granted.</p></ActionForm></div>}
        {s.status === "approved" && s.expires_at && new Date(s.expires_at) > new Date() && <StatusButton className="btn sm" action={revokeSupportAccessAction.bind(null, s.id)} label="End access now" />}</div>)}</div>
    {ctx.perms.has("billing.manage") && <div className="card"><h2>Close this company</h2>{d.cl.some((c: any) => c.status === "requested") ? <Alert tone="warn">A closure request is pending. Export what you need above; platform staff will confirm.</Alert> : <><p className="muted">Download your exports first. Closure is reviewed by platform staff before data is removed.</p><ActionForm action={requestClosureAction} submit="Request closure" danger confirm="Request closure of this company?"><Field name="reason" label="Reason (optional)" /><Field name="confirm" label={`Type “${ctx.tenant.name}” to confirm`} required /></ActionForm></>}</div>}</>);
}
