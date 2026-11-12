import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { PERMISSIONS } from "@/lib/perms";
import { saveRoleAction, deleteRoleAction } from "../actions";
export default async function Roles() {
  const ctx = await requireTenant("roles.manage");
  const roles = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select r.*, (select count(*) from memberships m where m.role_id=r.id) members from roles r where r.tenant_id=$1 order by is_system desc, name", [ctx.tenant.id])).rows);
  const groups = Object.entries(PERMISSIONS).reduce<Record<string, [string, string][]>>((g, [k, v]) => { (g[k.split(".")[0]] ??= []).push([k, v]); return g; }, {});
  const Perms = ({ sel, ro }: { sel: string[]; ro?: boolean }) => (<div className="grid g3">{Object.entries(groups).map(([g, ps]) => <fieldset key={g} className="field"><legend className="f" style={{ textTransform: "capitalize" }}>{g}</legend>{ps.map(([k, v]) => <label key={k} className="row small"><input type="checkbox" name="perm" value={k} defaultChecked={sel.includes(k)} disabled={ro || !ctx.perms.has(k)} /> {v}{["hr.sensitive", "finance.reverse", "finance.period", "sales.credit_override", "data.export", "roles.manage"].includes(k) && <Badge status="warn" label="sensitive" />}</label>)}</fieldset>)}</div>);
  return (<><PageHead title="Roles & permissions" crumbs={[["Company"], ["Roles"]]} sub="Built-in roles are fixed. Custom roles can combine permissions you hold yourself. Changing a role signs its members out so the change applies at once." />
    <details className="drawer"><summary>+ New custom role</summary><div><ActionForm action={saveRoleAction.bind(null, null)} submit="Create role"><Field name="name" label="Role name" required /><Perms sel={[]} /></ActionForm></div></details>
    {roles.map((r: any) => (<details className="drawer" key={r.id}><summary>{r.name} <span className="muted small">&nbsp;· {r.members} member(s) · {r.permissions.length} permissions {r.is_system && "· built-in"}</span></summary><div>
      {r.is_system ? <Perms sel={r.permissions} ro /> : <><ActionForm action={saveRoleAction.bind(null, r.id)} submit="Save role"><Field name="name" label="Role name" defaultValue={r.name} required /><Perms sel={r.permissions} /></ActionForm><StatusButton danger className="btn sm" action={deleteRoleAction.bind(null, r.id)} label="Delete role" confirm="Delete this role?" /></>}</div></details>))}</>);
}
