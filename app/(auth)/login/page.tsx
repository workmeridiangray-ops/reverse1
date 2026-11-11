import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { ActionForm } from "@/components/ActionForm";
import { Field, Hidden, Note } from "@/components/ui";
import { loginAction } from "../actions";
export const metadata = { title: "Sign in" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return <AuthCard title="Sign in" foot={<>New here? <Link className="text-brand underline" href="/signup">Start a free trial</Link></>}>
    {sp.expired && <Note tone="warn">Your session expired for security. Please sign in again — nothing was lost on the server.</Note>}
    {sp.reset && <Note tone="ok">Password updated. Sign in with the new password.</Note>}
    {sp.out && <Note>You have been signed out.</Note>}
    <ActionForm action={loginAction} submit="Sign in" className="space-y-3"><Hidden name="next" value={sp.next ?? "/app"} />
      <Field label="Email" name="email" type="email" required /><Field label="Password" name="password" type="password" required />
    </ActionForm>
    <p className="mt-4 text-sm"><Link className="text-brand underline" href="/forgot">Forgot password?</Link></p>
  </AuthCard>;
}
