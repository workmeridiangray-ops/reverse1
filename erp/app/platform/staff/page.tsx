import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { setStaffAction } from "../actions";
export default async function Staff() {
  await requirePlatform("owner");
  const rows = await withSystem(async (db) => (await db.query("select name, email, platform_role, totp_enabled from users where platform_role is not null order by platform_role, name")).rows);
  return (<><PageHead title="Platform staff" sub="Roles: owner (everything), billing, support (suspend, support access, requests), tech (jobs). Two-factor is mandatory." />
    <div className="card flush tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>2FA</th></tr></thead><tbody>{rows.map((u: any) => <tr key={u.email}><td>{u.name}</td><td>{u.email}</td><td><Badge status="info" label={u.platform_role} /></td><td>{u.totp_enabled ? "On" : <span className="badge bad">Not set up</span>}</td></tr>)}</tbody></table></div>
    <div className="card"><h2>Add or change staff</h2><ActionForm action={setStaffAction} submit="Save"><div className="grid g2"><Field name="email" label="User email (must have an account)" type="email" required /><Field name="role" label="Role" type="select"><option value="support">Support</option><option value="billing">Billing</option><option value="tech">Technical operations</option><option value="owner">Owner</option><option value="">Remove platform access</option></Field></div></ActionForm></div></>);
}
