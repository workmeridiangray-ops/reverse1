import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText } from "@/components/ui/Format";
import { CheckboxField, TextField } from "@/components/ui/Field";
import { Card, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireUser } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { changePassword, resendVerification, revokeSession, updateProfile } from "./actions";

export const metadata = { title: "My account" };
export default async function Account() {
  const a = await requireUser();
  const { u, sessions } = await tx({ userId: a.user.id }, async (db) => ({
    u: await db.one<{ name: string; email: string; notify_email: boolean }>("SELECT name,email,notify_email FROM users WHERE id=$1", [a.user.id]),
    sessions: await db.q<{ id: string; created_at: Date; last_seen_at: Date; user_agent: string | null }>("SELECT id,created_at,last_seen_at,user_agent FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC", [a.user.id]),
  }));
  return (
    <>
      <PageHeader title="My account" description={u.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile and notifications"><ActionForm action={updateProfile} submitLabel="Save">
          <TextField label="Name" name="name" defaultValue={u.name} /><CheckboxField label="Email me about approvals and invitations" name="notify_email" defaultChecked={u.notify_email} /></ActionForm>
          {!a.user.verified ? <div className="mt-4"><ActionForm action={resendVerification} submitLabel="Resend verification email" variant="secondary"><p className="text-sm">Your email is not verified.</p></ActionForm></div> : <p className="mt-4"><Badge status="verified" /> Email verified</p>}</Card>
        <Card title="Change password"><ActionForm action={changePassword} submitLabel="Change password" reset>
          <TextField label="Current password" name="current" type="password" autoComplete="current-password" /><TextField label="New password" name="password" type="password" autoComplete="new-password" minLength={10} hint="At least 10 characters with letters and a number. Other devices are signed out." /></ActionForm></Card>
      </div>
      <Card title="Active sessions" className="mt-6">
        <Table caption="Active sessions"><thead><tr><Th>Device</Th><Th>Signed in</Th><Th>Last active</Th><Th><span className="sr-only">Action</span></Th></tr></thead>
          <tbody>{sessions.map((s) => <tr key={s.id}><Td className="max-w-xs truncate">{s.user_agent ?? "Unknown"}{s.id === a.sessionId ? <> <Badge visual={{ label: "This device", tone: "info", icon: "dot" }} /></> : null}</Td><Td><DateTimeText at={s.created_at} /></Td><Td><DateTimeText at={s.last_seen_at} /></Td><Td>{s.id !== a.sessionId ? <ActionForm action={revokeSession} submitLabel="Sign out" variant="secondary"><input type="hidden" name="session_id" value={s.id} /></ActionForm> : null}</Td></tr>)}</tbody></Table>
      </Card>
    </>
  );
}
