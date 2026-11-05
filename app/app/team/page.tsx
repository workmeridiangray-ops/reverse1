import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText } from "@/components/ui/Format";
import { SelectField, TextField } from "@/components/ui/Field";
import { Card, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireCtx } from "@/lib/server/auth";
import { ROLE_LABEL, ROLES, permissionsOf } from "@/lib/rules/permissions";
import { changeRole, invite, revokeInvite, setMemberStatus } from "./actions";

export const metadata = { title: "Team" };
export default async function Team() {
  const c = await requireCtx();
  if (!c.can("team.view") && !c.can("users.manage")) return null;
  const { members, invites, projects } = await c.run(async (db) => ({
    members: await db.q<{ id: string; user_id: string; name: string; email: string; role: string; status: string; created_at: Date }>("SELECT m.id,m.user_id,u.name,u.email,m.role,m.status,m.created_at FROM memberships m JOIN users u ON u.id=m.user_id ORDER BY u.name"),
    invites: await db.q<{ id: string; email: string; role: string; expires_at: Date }>("SELECT id,email,role,expires_at FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC"),
    projects: await db.q<{ id: string; code: string; name: string }>("SELECT id,code,name FROM projects WHERE status <> 'closed' ORDER BY code"),
  }));
  const manage = c.can("users.manage");
  return (
    <>
      <PageHeader title="Team" description="Members, invitations and what each role can do." />
      <Card title="Members">
        <Table caption="Members"><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th>{manage ? <Th>Actions</Th> : null}</tr></thead>
          <tbody>{members.map((m) => (<tr key={m.id}><Td className="font-bold">{m.name}</Td><Td>{m.email}</Td>
            <Td>{manage && m.user_id !== c.user.id ? <ActionForm action={changeRole} submitLabel="Set" variant="secondary" className="!flex-row !items-end"><input type="hidden" name="membership_id" value={m.id} /><SelectField label="Role" name="role" id={`role-${m.id}`} defaultValue={m.role}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</SelectField></ActionForm> : ROLE_LABEL[m.role as keyof typeof ROLE_LABEL]}</Td>
            <Td><Badge status={m.status === "active" ? "active" : "suspended"} /></Td>
            {manage ? <Td>{m.user_id !== c.user.id ? <ActionForm action={setMemberStatus} submitLabel={m.status === "active" ? "Suspend" : "Reactivate"} variant="secondary"><input type="hidden" name="membership_id" value={m.id} /><input type="hidden" name="status" value={m.status === "active" ? "suspended" : "active"} /></ActionForm> : "You"}</Td> : null}</tr>))}</tbody></Table>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Pending invitations">
          {invites.length === 0 ? <p className="text-ink-500">None.</p> : <ul className="space-y-3">{invites.map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2"><span>{i.email} · {ROLE_LABEL[i.role as keyof typeof ROLE_LABEL]} · expires <DateText at={i.expires_at} /></span>{manage ? <ActionForm action={revokeInvite} submitLabel="Revoke" variant="secondary"><input type="hidden" name="invitation_id" value={i.id} /></ActionForm> : null}</li>)}</ul>}
        </Card>
        {manage ? (
          <Card title="Invite someone"><ActionForm action={invite} submitLabel="Send invitation" reset>
            <TextField label="Email" name="email" type="email" /><SelectField label="Role" name="role">{ROLES.filter((r) => r !== "owner" || c.role === "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</SelectField>
            <fieldset><legend className="text-sm font-bold">Projects <span className="font-normal text-ink-500">(required for client / consultant)</span></legend>
              <div className="mt-1 max-h-40 space-y-1 overflow-auto">{projects.map((p) => <label key={p.id} className="flex min-h-touch items-center gap-2"><input type="checkbox" name="project_ids" value={p.id} className="h-5 w-5" /> {p.code} — {p.name}</label>)}</div></fieldset>
          </ActionForm></Card>
        ) : null}
      </div>
      <Card title="Role permissions" className="mt-6">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Permissions by role</caption><tbody>{ROLES.map((r) => <tr key={r} className="border-b border-line align-top"><th scope="row" className="py-2 pr-4">{ROLE_LABEL[r]}</th><td className="py-2 text-ink-700">{permissionsOf(r).includes("*") ? "Everything, including users and settings" : permissionsOf(r).join(", ")}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  );
}
