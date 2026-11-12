import Link from 'next/link';
import ActionForm from '@/components/ActionForm';
import { Field, Alert } from '@/components/ui';
import { resetAction } from '@/app/actions/auth';
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <><h1>Reset link needed</h1><div className="mt-3"><Alert kind="warn">Open the link from your email, or request a new one.</Alert></div><p className="mt-4"><Link className="btn" href="/forgot">Request a link</Link></p></>;
  return (
    <>
      <h1>Choose a new password</h1>
      <div className="mt-4"><ActionForm action={resetAction} submit="Update password">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" name="password" help="At least 10 characters, with letters and a number."><input id="password" name="password" type="password" className="input" autoComplete="new-password" required minLength={10} /></Field>
        <Field label="Confirm new password" name="confirm"><input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" required /></Field>
      </ActionForm></div>
    </>
  );
}
