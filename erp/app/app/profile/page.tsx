import { requireUser } from "@/lib/auth/session";
import { withSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { TotpSetup } from "@/components/TotpSetup";
import { changePasswordAction, disableTotpAction, revokeSessionAction, savePrefsAction } from "@/lib/auth/actions";
export const metadata = { title: "Profile and security" };
export default async function Profile() {
  const ctx = await requireUser();
  const d = await withSystem(async (db) => ({ sessions: (await db.query("select id, ip, user_agent, created_at, last_seen_at from sessions where user_id=$1 and revoked_at is null and expires_at>now() order by last_seen_at desc", [ctx.user.id])).rows,
    u: (await db.query("select notif_prefs, totp_enabled, name from users where id=$1", [ctx.user.id])).rows[0] }));
  return (<><PageHead title="Profile and security" crumbs={[["Profile"]]} sub={ctx.user.email} />
    <div className="card"><h2>Profile and notifications</h2><ActionForm action={savePrefsAction} submit="Save"><Field name="name" label="Display name" defaultValue={d.u.name} />
      <div className="field"><label className="row"><input type="checkbox" name="email_approvals" defaultChecked={d.u.notif_prefs.email_approvals} /> Email me when an approval needs my decision</label></div>
      <div className="field"><label className="row"><input type="checkbox" name="email_billing" defaultChecked={d.u.notif_prefs.email_billing} /> Email me about billing and payments (owners)</label></div></ActionForm></div>
    <div className="card"><h2>Password</h2><ActionForm action={changePasswordAction} submit="Change password" resetOnSuccess><Field name="current" label="Current password" type="password" required autoComplete="current-password" /><Field name="password" label="New password" type="password" required autoComplete="new-password" hint="At least 10 characters with letters and a number. Other devices are signed out." /></ActionForm></div>
    <div className="card"><h2>Two-factor authentication {d.u.totp_enabled ? <Badge status="active" label="on" /> : <Badge status="draft" label="off" />}</h2>
      {d.u.totp_enabled ? <><p className="muted">Codes from your authenticator app are required at sign-in.</p>{ctx.user.platformRole ? <p className="small muted">Mandatory for platform staff.</p> : <details><summary>Turn off…</summary><ActionForm action={disableTotpAction} submit="Turn off two-factor" danger><Field name="password" label="Confirm your password" type="password" required /></ActionForm></details>}</> : <TotpSetup />}</div>
    <div className="card"><h2>Active sessions</h2><div className="tablewrap"><table className="stack-sm"><thead><tr><th>Device</th><th>IP</th><th>Last active</th><th></th></tr></thead><tbody>
      {d.sessions.map((s: any) => <tr key={s.id}><td data-label="Device">{(s.user_agent || "Unknown").slice(0, 60)}{s.id === ctx.sessionId && <> <Badge status="active" label="this device" /></>}</td><td data-label="IP">{s.ip ?? "—"}</td><td data-label="Last active">{new Date(s.last_seen_at).toLocaleString("en-IN")}</td><td>{s.id !== ctx.sessionId && <StatusButton className="btn sm" action={revokeSessionAction.bind(null, s.id)} label="Sign out" />}</td></tr>)}</tbody></table></div></div></>);
}
