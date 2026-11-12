import { PageHeader, Card, Field, Alert } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import MfaSetup from '@/components/MfaSetup';
import { requireSession } from '@/lib/session';
import { changePasswordAction, disableMfaAction } from '@/app/actions/auth';
export default async function Security() { const s = await requireSession(); return (<><PageHeader title="Security" />
  <div className="grid lg:grid-cols-2 gap-6"><Card title="Change password"><ActionForm action={changePasswordAction} submit="Change password"><Field label="Current password" name="current"><input id="current" name="current" type="password" className="input" autoComplete="current-password" required /></Field><Field label="New password" name="new"><input id="new" name="new" type="password" className="input" autoComplete="new-password" minLength={10} required /></Field><Field label="Confirm new password" name="confirm"><input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" required /></Field></ActionForm></Card>
  <Card title="Two-factor sign-in">{s.user.totpEnabled ? <ActionForm action={disableMfaAction} submit="Turn off" submitClass="btn btn-danger"><Alert kind="ok">Two-factor sign-in is on.</Alert><Field label="Confirm with your password" name="password"><input id="password" name="password" type="password" className="input" required /></Field></ActionForm> : <MfaSetup />}</Card></div></>); }
