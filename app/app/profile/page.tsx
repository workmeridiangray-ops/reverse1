import { requireUser } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { Page, Card, Field, Grid, DataTable, Badge, Hidden, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { changePasswordAction, updateProfileAction, startTotpAction, confirmTotpAction, disableTotpAction, revokeSessionAction, resendVerifyAction } from "../../(auth)/actions";
export const metadata = { title: "Profile & security" };
export const dynamic = "force-dynamic";
export default async function P() {
  const a = await requireUser();
  const u = (await plat("select * from users where id=$1", [a.user.id])).rows[0];
  const sess = (await plat("select id, user_agent, ip, created_at, last_seen_at from sessions where user_id=$1 and revoked_at is null and expires_at>now() order by last_seen_at desc", [a.user.id])).rows;
  return <Page title="Profile & security">
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Profile"><ActionForm action={updateProfileAction} submit="Save"><Field label="Name" name="name" defaultValue={u.name} required /><p className="mt-2 text-sm text-muted">{u.email} {u.email_verified_at ? "· verified" : "· not verified"}</p>
        <fieldset className="mt-3"><legend className="label">Notifications</legend><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="email_n" defaultChecked={u.notif_prefs?.email !== false} className="h-4 w-4" /> Email</label><label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" name="inapp_n" defaultChecked={u.notif_prefs?.inapp !== false} className="h-4 w-4" /> In-app</label></fieldset></ActionForm>
        {!u.email_verified_at && <ActionForm action={resendVerifyAction} submit="Resend verification email" secondary small className="mt-3">{null}</ActionForm>}</Card>
      <Card title="Change password"><ActionForm action={changePasswordAction} submit="Update password" resetOnOk><Field label="Current password" name="current" type="password" required /><Field label="New password" name="next" type="password" required className="mt-2" /><Field label="Confirm new password" name="confirm" type="password" required className="mt-2" /></ActionForm></Card>
      <Card title="Two-factor authentication">{u.totp_enabled ? <><p className="mb-2 text-sm text-ok">Enabled.</p><ActionForm action={disableTotpAction} submit="Turn off" danger><Field label="Current code" name="code" required /></ActionForm></> : u.totp_secret ? <><p className="text-sm">Add this secret to your authenticator app (manual entry, time-based):</p><code className="my-2 block break-all rounded bg-sunken p-2 text-sm">{u.totp_secret}</code><ActionForm action={confirmTotpAction} submit="Confirm & enable"><Field label="6-digit code" name="code" required /></ActionForm></> : <ActionForm action={startTotpAction} submit="Set up two-factor">{null}</ActionForm>}</Card>
      <Card title="Active sessions"><DataTable rows={sess} cols={[{ h: "Device", r: (r: any) => (r.id === a.session.id ? <>{(r.user_agent ?? "").slice(0, 40)} <Badge s="active" label="this device" /></> : (r.user_agent ?? "").slice(0, 40)) }, { h: "Last seen", r: (r: any) => dt(r.last_seen_at) }, { h: "", r: (r: any) => r.id !== a.session.id ? <form action={revokeSessionAction}><Hidden name="id" value={r.id} /><button className="text-brand underline">Sign out</button></form> : null }]} /></Card>
    </div></Page>;
}
