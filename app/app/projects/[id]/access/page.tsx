import { ActionForm } from "@/components/ui/ActionForm";
import { SelectField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { ROLE_LABEL, isRole } from "@/lib/rules/permissions";
import { grantAccess, revokeAccess } from "./actions";

export const metadata = { title: "Project access" };
export default async function Access({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("project.access");
  const { p, granted, people } = await c.run(async (db) => ({
    p: await getProject(db, id),
    granted: await db.q<{ user_id: string; name: string; email: string; role: string }>("SELECT a.user_id,u.name,u.email,m.role FROM project_access a JOIN users u ON u.id=a.user_id JOIN memberships m ON m.user_id=a.user_id AND m.tenant_id=a.tenant_id WHERE a.project_id=$1 ORDER BY u.name", [id]),
    people: await db.q<{ user_id: string; name: string; role: string }>("SELECT m.user_id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.status='active' AND m.role <> 'owner' ORDER BY u.name"),
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  return (
    <>
      <PageHeader eyebrow={p.code} title="Project access" description="Clients, consultants and any member with explicit assignments only see the projects listed here. Owners always see everything. A member with no assignments sees all projects." />
      <ProjectTabs c={c} id={id} active="access" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {granted.length === 0 ? <EmptyState title="No explicit assignments" /> : (
          <Card><Table caption="People with explicit access"><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th><span className="sr-only">Remove</span></Th></tr></thead>
            <tbody>{granted.map((g) => <tr key={g.user_id}><Td className="font-bold">{g.name}</Td><Td>{g.email}</Td><Td>{isRole(g.role) ? ROLE_LABEL[g.role] : g.role}</Td><Td><ActionForm action={revokeAccess} submitLabel="Remove" variant="secondary">{hid}<input type="hidden" name="user_id" value={g.user_id} /></ActionForm></Td></tr>)}</tbody></Table></Card>
        )}
        <Card title="Grant access"><ActionForm action={grantAccess} submitLabel="Grant access">{hid}<SelectField label="Person" name="user_id"><option value="">Choose…</option>{people.map((x) => <option key={x.user_id} value={x.user_id}>{x.name} — {isRole(x.role) ? ROLE_LABEL[x.role] : x.role}</option>)}</SelectField></ActionForm></Card>
      </div>
    </>
  );
}
