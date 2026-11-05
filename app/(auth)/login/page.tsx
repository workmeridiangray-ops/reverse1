import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/Layout";
import { ActionForm } from "@/components/ui/ActionForm";
import { TextField } from "@/components/ui/Field";
import { getAuth } from "@/lib/server/auth";
import { signIn } from "../actions";

export const metadata = { title: "Sign in" };
const REASONS: Record<string, [("info" | "warn" | "ok"), string]> = {
  expired: ["warn", "Your session expired or was signed out elsewhere. Sign in again — your saved records are safe."],
  "signed-out": ["ok", "You have been signed out."],
  "password-reset": ["ok", "Password updated. Sign in with your new password; other devices were signed out."],
  revoked: ["warn", "Your access was removed. Contact your administrator."],
};
export default async function Login({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next } = await searchParams;
  const { auth } = await getAuth();
  if (auth) redirect("/app");
  const r = reason ? REASONS[reason] : undefined;
  return (
    <>
      <h1 className="mb-4 text-heading font-bold">Sign in</h1>
      {r ? <div className="mb-4"><Alert tone={r[0]}>{r[1]}</Alert></div> : null}
      <ActionForm action={signIn} submitLabel="Sign in" pendingLabel="Signing in…">
        <input type="hidden" name="next" value={next ?? ""} />
        <TextField label="Email" name="email" type="email" autoComplete="username" />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" />
      </ActionForm>
      <p className="mt-4 text-sm"><Link href="/forgot">Forgot password?</Link> · <Link href="/signup">Create an account</Link></p>
    </>
  );
}
