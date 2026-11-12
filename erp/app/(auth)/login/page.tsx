import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
import { loginAction, resendVerifyAction } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
export const metadata: Metadata = { title: "Sign in" };
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string; reset?: string; suspended?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="card">
      <h1>Sign in</h1>
      {sp.expired && <Alert tone="warn">Your session expired or you were signed out. Sign in again to continue.</Alert>}
      {sp.reset && <Alert tone="ok">Password updated. Sign in with the new password.</Alert>}
      <ActionForm action={loginAction} submit="Sign in" guard={false}>
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field name="email" label="Work email" type="email" required autoComplete="username" />
        <Field name="password" label="Password" type="password" required autoComplete="current-password" />
      </ActionForm>
      <p className="small" style={{ marginTop: 16 }}><Link href="/forgot">Forgot your password?</Link> · <Link href="/signup">Create a company</Link></p>
      <details><summary className="small muted">Didn’t get the verification email?</summary>
        <ActionForm action={resendVerifyAction} submit="Resend link" guard={false}><Field name="email" label="Email" type="email" required /></ActionForm></details>
    </div>
  );
}
