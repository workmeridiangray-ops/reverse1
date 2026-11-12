import { ActionForm, Field } from "@/components/ActionForm";
import { resetAction } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
import Link from "next/link";
export const metadata = { title: "Choose a new password" };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return (<div className="card"><Alert tone="bad">This reset link is incomplete.</Alert><Link className="btn" href="/forgot">Request a new link</Link></div>);
  return (<div className="card"><h1>Choose a new password</h1><p className="muted">All your other sessions will be signed out.</p>
    <ActionForm action={resetAction} submit="Update password" guard={false}><input type="hidden" name="token" value={token} />
      <Field name="password" label="New password" type="password" required autoComplete="new-password" hint="At least 10 characters with letters and a number." />
      <Field name="confirm" label="Confirm password" type="password" required autoComplete="new-password" /></ActionForm></div>);
}
