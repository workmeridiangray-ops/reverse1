import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { inviteAction, revokeInviteAction, changeMemberAction, setMemberStatusAction } from "../actions";
import { usage, subscriptionOf } from "@/lib/billing";
export default async function Team() {
  const ctx = await requireTenant("users.manage");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({
    members: (await db.query("select m.id, m.user_id, m.status, m.role_id, m.branch_ids, u.name, u.email, u.totp_enabled, r.name role, r.key from memberships m join users u on u.id=m.user_id join roles r on r.id=m.role_id where m.tenant_id=$1 and m.customer_id is null order by u.name", [ctx.tenant.id])).rows,
    invites: (await db.query("select i.*, r.name role from invitations i join roles r on r.id=i.role_id where i.tenant_id=$1 order by i.created_at desc limit 30", [ctx.tenant.id])).rows,
    roles: (await db.query("select id, name from roles where tenant_id=$1 and key <> 'customer' order by is_system desc, name", [ctx.tenant.id])).rows, branches: (await db.query("select id, name from branches where tenant_id=$1 and status='active' order by name", [ctx.tenant.id])).rows,
    use: await usage(db, ctx.tenant.id), sub: await subscriptionOf(db, ctx.tenant.id) }));
  const BranchPick = ({ sel }: { sel?: string[] | null }) => (<fieldset className="field"><legend className="f">Branch access <span className="muted small">(none ticked = all branches)</span></legend>{d.branches.map((b: any) => <label key={b.id} className="row"><input type="checkbox" name="branch_ids" value={b.id} defaultChecked={!!sel?.includes(b.id)} /> {b.name}</label>)}</fieldset>);
  return (<><PageHead title="Team & invitations" crumbs={[["Company"], ["Team"]]} sub={d.sub ? `${d.use.users} of ${d.sub.max_users} users used on the ${d.sub.plan_name} plan (${d.use.pendingInvites} invitation(s) pending).` : ""} />
    <details className="drawer"><summary>+ Invite someone</summary><div><ActionForm action={inviteAction} submit="Send invitation" resetOnSuccess><div className="grid g2"><Field name="email" label="Email" type="email" required /><Field name="role_id" label="Role" type="select" required><option value="">Choose…</option>{d.roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Field></div><BranchPick /></ActionForm></div></details>
    <div className="card flush"><div className="tablewrap"><table className="stack-sm"><thead><tr><th>Person</th><th>Role</th><th>Branches</th><th>2FA</th><th>Status</th><th></th></tr></thead><tbody>
      {d.members.map((m: any) => (<tr key={m.id}><td data-label="Person">{m.name}<br /><span className="muted small">{m.email}</span></td><td data-label="Role">{m.role}</td><td data-label="Branches">{m.branch_ids ? m.branch_ids.length : "All"}</td><td data-label="2FA">{m.totp_enabled ? "On" : "Off"}</td><td data-label="Status"><Badge status={m.status} /></td>
        <td>{m.user_id !== ctx.user.id && <details><summary className="btn sm">Manage</summary>
          <ActionForm action={changeMemberAction.bind(null, m.id)} submit="Update access"><Field name="role_id" label="Role" type="select" defaultValue={m.role_id}>{d.roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Field><BranchPick sel={m.branch_ids} /></ActionForm>
          {m.status === "active" ? <div className="row"><StatusButton className="btn sm" action={setMemberStatusAction.bind(null, m.id, "suspended")} label="Suspend" confirm="Suspend and sign this person out everywhere?" /><StatusButton danger className="btn sm" action={setMemberStatusAction.bind(null, m.id, "removed")} label="Remove" confirm="Remove this person? Their sessions end immediately." /></div> : <StatusButton className="btn sm" action={setMemberStatusAction.bind(null, m.id, "active")} label="Restore access" />}</details>}</td></tr>))}</tbody></table></div></div>
    <div className="card"><h2>Invitations</h2>{d.invites.length === 0 ? <p className="muted">None sent.</p> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>{d.invites.map((i: any) => <tr key={i.id}><td data-label="Email">{i.email}</td><td data-label="Role">{i.role}</td><td data-label="Status"><Badge status={i.status === "pending" && new Date(i.expires_at) < new Date() ? "expired" : i.status} /></td><td data-label="Expires">{new Date(i.expires_at).toLocaleDateString("en-IN")}</td><td>{i.status === "pending" && <StatusButton className="btn sm" action={revokeInviteAction.bind(null, i.id)} label="Withdraw" />}</td></tr>)}</tbody></table></div>}
      <p className="small muted">To re-send an expired or lost invitation, invite the same email again; the old link stops working.</p></div></>);
}
