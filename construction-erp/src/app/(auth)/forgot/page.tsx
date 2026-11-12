import Link from 'next/link';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/ui';
import { forgotAction } from '@/app/actions/auth';
export default function Forgot() {
  return (
    <>
      <h1>Reset your password</h1>
      <p className="text-muted mt-1 mb-4">Enter your email and we will send a link that works for 1 hour.</p>
      <ActionForm action={forgotAction} submit="Send reset link">
        <Field label="Email" name="email"><input id="email" name="email" type="email" className="input" required /></Field>
      </ActionForm>
      <p className="text-sm mt-5"><Link href="/login">Back to sign in</Link></p>
    </>
  );
}
