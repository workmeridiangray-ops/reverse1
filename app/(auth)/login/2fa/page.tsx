import { AuthCard } from "@/components/AuthCard";
import { ActionForm } from "@/components/ActionForm";
import { Field, Hidden } from "@/components/ui";
import { mfaAction, logoutAction } from "../../actions";
export const metadata = { title: "Two-factor verification" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return <AuthCard title="Two-factor verification" sub="Enter the 6-digit code from your authenticator app.">
    <ActionForm action={mfaAction} submit="Verify" className="space-y-3"><Hidden name="next" value={sp.next ?? "/app"} /><Field label="Code" name="code" required placeholder="123456" /></ActionForm>
    <form action={logoutAction} className="mt-4"><button className="text-sm text-brand underline">Cancel and sign out</button></form>
  </AuthCard>;
}
