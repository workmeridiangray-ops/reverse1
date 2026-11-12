import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { requestLeaveAction, decideLeaveAction } from "../../ops-actions";
export default async function Leave() {
  const ctx = await requireTenant("hr.view"); const mgr = ctx.perms.has("hr.manage");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ rows: (await db.query("select l.*, e.name from leave_requests l join employees e on e.id=l.employee_id and e.tenant_id=l.tenant_id where l.tenant_id=$1 and ($2 or e.user_id=$3) order by l.created_at desc limit 60", [ctx.tenant.id, mgr, ctx.user.id])).rows,
    emps: (await db.query("select id, name from employees where tenant_id=$1 and status='active' and ($2 or user_id=$3) order by name", [ctx.tenant.id, mgr, ctx.user.id])).rows }));
  return (<><PageHead title="Leave requests" crumbs={[["Operations"], ["Leave"]]} sub="Attendance summaries are imported by HR; payroll is a separate extension." />
    {d.emps.length > 0 ? <details className="drawer"><summary>+ Request leave</summary><div><ActionForm action={requestLeaveAction} submit="Request leave" resetOnSuccess><div className="grid g3"><Field name="employee_id" label="Employee" type="select" required>{d.emps.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</Field><Field name="leave_type" label="Type" type="select"><option value="casual">Casual</option><option value="sick">Sick</option><option value="earned">Earned</option></Field><Field name="reason" label="Reason" /><Field name="starts_on" label="From" type="date" required /><Field name="ends_on" label="To" type="date" required /></div></ActionForm></div></details> : <p className="muted">Your login isn’t linked to an employee record, so you can’t request leave here. Ask HR.</p>}
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No leave requests" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>
      {d.rows.map((l: any) => <tr key={l.id}><td data-label="Employee">{l.name}</td><td data-label="Type">{l.leave_type}</td><td data-label="Dates">{l.starts_on} → {l.ends_on}</td><td data-label="Status"><Badge status={l.status} />{l.decision_reason && <span className="muted small"> {l.decision_reason}</span>}</td>
        <td>{mgr && l.status === "pending" && <details><summary className="btn sm">Decide</summary><div className="grid g2"><ActionForm action={decideLeaveAction.bind(null, l.id, true)} submit="Approve"><Field name="reason" label="Note" /></ActionForm><ActionForm action={decideLeaveAction.bind(null, l.id, false)} submit="Reject" danger><Field name="reason" label="Reason" required /></ActionForm></div></details>}</td></tr>)}</tbody></table></div>}</div></>);
}
