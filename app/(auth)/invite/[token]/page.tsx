import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { ActionForm } from "@/components/ActionForm";
import { Field, Hidden, Note } from "@/components/ui";
import { invitationState } from "@/lib/server/accounts";
import { getAuth } from "@/lib/server/auth";
import { acceptInviteAction } from "../../actions";
import { ROLE_LABEL } from "@/lib/server/perms";
export const metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";
const MSG: Record<string, string> = { invalid: "This invitation link is not valid.", revoked: "This invitation was cancelled by the company. Ask them to send a new one.", used: "This invitation has already been accepted. Sign in to continue.", expired: "This invitation has expired. Ask the company owner to send a new one." };
export default async function P({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const s = await invitationState(token);
  if (s.state !== "ok") return <AuthCard title="Invitation unavailable" foot={<Link className="text-brand underline" href="/login">Sign in</Link>}><Note tone="warn">{MSG[s.state]}</Note></AuthCard>;
  const a = await getAuth(); const me = a && !("expired" in a) ? a : null;
  return <AuthCard title={`Join ${s.inv.company}`} sub={`You’re invited as ${ROLE_LABEL[s.inv.role as keyof typeof ROLE_LABEL] ?? s.inv.role} (${s.inv.email}).`}>
    {me ? <ActionForm action={acceptInviteAction} submit="Accept invitation"><Hidden name="token" value={token} /></ActionForm>
      : s.hasAccount ? <Note>An account already exists for {s.inv.email}. <Link className="underline" href={`/login?next=/invite/${token}`}>Sign in</Link>, then return to this link.</Note>
      : <ActionForm action={acceptInviteAction} submit="Create account & join" className="space-y-3"><Hidden name="token" value={token} /><Field label="Your name" name="name" required /><Field label="Choose a password" name="password" type="password" required hint="At least 10 characters, with letters and a number." /></ActionForm>}
  </AuthCard>;
}
