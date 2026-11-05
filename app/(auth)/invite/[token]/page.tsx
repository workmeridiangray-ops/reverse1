import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { getAuth, sha256 } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { ROLE_LABEL, isRole } from "@/lib/rules/permissions";
import { acceptInvite } from "../../actions";

export const metadata = { title: "Accept invitation" };
export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { auth } = await getAuth();
  const inv = await tx({ inviteLookup: true }, (db) => db.maybe<{ email: string; role: string; tname: string; accepted_at: Date | null; revoked_at: Date | null; expired: boolean }>(
    `SELECT i.email, i.role, t.name tname, i.accepted_at, i.revoked_at, i.expires_at < now() expired FROM invitations i JOIN tenants t ON t.id = i.tenant_id WHERE i.token_hash = $1`, [sha256(token)]));
  const state = !inv ? "invalid" : inv.revoked_at ? "revoked" : inv.accepted_at ? "used" : inv.expired ? "expired" : "ok";
  if (!inv || state !== "ok") {
    const msg = { invalid: "This invitation link is not valid.", revoked: "This invitation was revoked by the sender.", used: "This invitation has already been used.", expired: "This invitation has expired.", ok: "" }[state];
    return (<><Alert tone="danger" title={msg}>Ask the person who invited you to send a new invitation.</Alert><p className="mt-4"><Link href="/login">Sign in</Link></p></>);
  }
  const role = isRole(inv.role) ? ROLE_LABEL[inv.role] : inv.role;
  return (
    <>
      <h1 className="mb-1 text-heading font-bold">Join {inv.tname}</h1>
      <p className="mb-4 text-ink-700">You are invited as <strong>{role}</strong> using {inv.email}.</p>
      <ActionForm action={acceptInvite} submitLabel={auth ? "Accept invitation" : "Create account and join"}>
        <input type="hidden" name="token" value={token} />
        {auth ? <Alert tone="info">Signed in as {auth.user.email}.</Alert> : (
          <>
            <TextField label="Your name" name="name" autoComplete="name" />
            <TextField label="Choose a password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters with letters and a number." minLength={10} />
            <p className="text-sm">Already have an account? <Link href={`/login?next=${encodeURIComponent("/invite/" + token)}`}>Sign in first</Link>.</p>
          </>
        )}
      </ActionForm>
    </>
  );
}
