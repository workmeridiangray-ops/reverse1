import { ActionForm, Field } from "@/components/ActionForm";
import { twoFactorAction, logoutAction } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
export const metadata = { title: "Two-factor verification" };
export default async function TwoFa({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams; const ctx = await requireUser();
  if (ctx.mfaOk) redirect(sp.next ?? "/workspaces");
  return (
    <div className="card"><h1>Two-factor verification</h1>
      <p className="muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      <ActionForm action={twoFactorAction} submit="Verify" guard={false}>
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field name="code" label="Code" required autoComplete="one-time-code" placeholder="123456" />
      </ActionForm>
      <form action={logoutAction} style={{ marginTop: 12 }}><button className="btn sm ghost">Cancel and sign out</button></form>
    </div>
  );
}
