import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/ui';
import { mfaAction, logoutAction } from '@/app/actions/auth';
export default function Verify() {
  return (
    <>
      <h1>Two-factor verification</h1>
      <p className="text-muted mt-1 mb-4">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={mfaAction} submit="Verify">
        <Field label="Code" name="code"><input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" className="input" required autoFocus /></Field>
      </ActionForm>
      <form action={logoutAction} className="mt-4"><button className="text-sm underline text-muted">Use a different account</button></form>
    </>
  );
}
