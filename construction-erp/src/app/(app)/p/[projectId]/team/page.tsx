import { redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Field, fmtDate, Alert } from '@/components/ui';
import ActionForm, { ConfirmButton } from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { addProjectMemberAction, endProjectMemberAction, inviteExternalAction } from '@/app/actions/project';
import { formatINR } from '@/lib/rules/money';
export const metadata = { title: 'Team & authority · Buildline' };
const AUTH: [string, string][] = [['po:approve', 'Approve purchase orders & subcontract bills'], ['bill:certify', 'Certify running bills (client / consultant)'], ['variation:approve', 'Decide variations (client / consultant)'], ['bill:submit', 'Submit bills'], ['variation:submit', 'Submit variations']];
export default async function Team({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('project:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { await projectOrNotFound(q, projectId); return {
    members: await many<any>(q, `select pm.*, u.name, u.email, p.name party from project_members pm join users u on u.id = pm.user_id left join parties p on p.id = pm.party_id where pm.project_id = $1 order by pm.effective_to nulls first, u.name`, [projectId]),
    users: await many<any>(q, `select u.id, u.name || ' (' || m.role || ')' label from users u join memberships m on m.user_id = u.id and m.status='active' where m.org_id = app_org() order by 2`),
    parties: await many<any>(q, `select id, name from parties where kind in ('subcontractor','contractor','consultant','client') order by name`) }; });
  const can = perms.has('team:edit');
  return (<><PageHeader title="Team & authority matrix" sub="Who works on this project, and which approvals they may give, up to what amount. Assignments keep their dates." />
    <Table head={[{ label: 'Person' }, { label: 'Role' }, { label: 'Authorities', hideSm: true }, { label: 'Limit', hideSm: true }, { label: 'From' }, { label: 'To' }, { label: '' }]}>
      {d.members.map((m: any) => <tr key={m.id}><Td>{m.name}<div className="text-xs text-muted">{m.email}{m.party ? ` · ${m.party}` : ''}</div></Td><Td>{m.project_role}</Td><Td hideSm>{m.authorities.join(', ') || '—'}</Td><Td hideSm>{formatINR(m.approval_limit_paise)}</Td><Td>{fmtDate(m.effective_from)}</Td><Td>{m.effective_to ? fmtDate(m.effective_to) : <Badge status="active" />}</Td><Td>{can && !m.effective_to && <ConfirmButton action={endProjectMemberAction.bind(null, m.id)} label="End access" confirmText={`End ${m.name}'s access to this project?`} />}</Td></tr>)}
    </Table>
    {can && <div className="grid lg:grid-cols-2 gap-6 mt-6">
      <Card title="Assign a team member"><ActionForm action={addProjectMemberAction.bind(null, projectId)} submit="Save assignment" resetOnSuccess>
        <Field label="Person" name="user_id" required><select id="user_id" name="user_id" className="input" required><option value="">Choose…</option>{d.users.map((u: any) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
        <Field label="Approval limit (₹)" name="limit" help="0 = cannot approve amounts. Owners and managers are unlimited."><input id="limit" name="limit" className="input" inputMode="decimal" defaultValue="0" /></Field>
        <fieldset><legend className="label">Delegated authorities</legend>{AUTH.map(([k, l]) => <label key={k} className="flex items-center gap-2 min-h-[36px]"><input type="checkbox" name="authorities" value={k} className="h-5 w-5" /> {l}</label>)}</fieldset>
        <Field label="Effective from" name="effective_from"><input id="effective_from" name="effective_from" type="date" className="input" /></Field><p className="help">Saving again replaces the current assignment and keeps the old one in history.</p></ActionForm></Card>
      <Card title="Invite a client, consultant or contractor"><ActionForm action={inviteExternalAction.bind(null, projectId)} submit="Send invitation" resetOnSuccess>
        <Field label="Email" name="email" required><input id="email" name="email" type="email" className="input" required /></Field>
        <Field label="Access type" name="role" required><select id="role" name="role" className="input" required><option value="">Choose…</option><option value="client">Client</option><option value="consultant">Consultant</option><option value="contractor">Subcontractor / contractor</option></select></Field>
        <Field label="Company" name="party_id" help="Required for subcontractors — they only see their own work orders."><select id="party_id" name="party_id" className="input"><option value="">—</option>{d.parties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <p className="help">External people see only this project, and only approved drawings, submitted bills and decisions addressed to them. After they join, set their authorities above.</p></ActionForm></Card>
    </div>}</>);
}
