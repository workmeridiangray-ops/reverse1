import Link from 'next/link';
import ActionForm from '@/components/ActionForm';
import { Field, Alert } from '@/components/ui';
import { loginAction } from '@/app/actions/auth';
export const metadata = { title: 'Sign in · Buildline' };
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      <div className="mt-3 space-y-3">
        {sp.expired && <Alert kind="warn">Your session expired. Sign in again to continue — nothing you saved was lost.</Alert>}
        {sp.out && <Alert kind="ok">You have been signed out.</Alert>}
        {sp.reset && <Alert kind="ok">Password updated. Sign in with your new password.</Alert>}
        {sp.joined && <Alert kind="ok">You have joined the workspace. Sign in to continue.</Alert>}
      </div>
      <div className="mt-4"><ActionForm action={loginAction} submit="Sign in">
        <input type="hidden" name="next" value={sp.next ?? ''} />
        <Field label="Email" name="email"><input id="email" name="email" type="email" className="input" autoComplete="username" required /></Field>
        <Field label="Password" name="password"><input id="password" name="password" type="password" className="input" autoComplete="current-password" required /></Field>
      </ActionForm></div>
      <p className="text-sm mt-5 flex justify-between"><Link href="/forgot">Forgot password?</Link><Link href="/signup">Start free trial</Link></p>
    </>
  );
}
