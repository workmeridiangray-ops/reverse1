import Link from "next/link";
import { withSystem } from "@/lib/db";
import { sha256 } from "@/lib/auth/password";
import { getCtx } from "@/lib/auth/session";
import { ActionForm, Field } from "@/components/ActionForm";
import { acceptInviteAction } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
export const metadata = { title: "Invitation" };
export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getCtx();
  const inv = await withSystem(async (db) => (await db.query(
    `select i.*, t.name tname, r.name rname, exists(select 1 from users u where lower(u.email)=lower(i.email)) has_user
       from invitations i join tenants t on t.id=i.tenant_id join roles r on r.id=i.role_id where i.token_hash=$1`, [sha256(token)])).rows[0]);
  if (!inv || inv.status === "revoked") return <div className="card"><h1>Invitation not available</h1><Alert tone="bad">{inv ? "This invitation was withdrawn by the company." : "This invitation link is not valid."}</Alert><p>Ask the company administrator to send a new invitation.</p></div>;
  if (inv.status === "accepted") return <div className="card"><h1>Already accepted</h1><p>This invitation has already been used.</p><Link className="btn primary" href="/login">Sign in</Link></div>;
  if (inv.status === "expired" || new Date(inv.expires_at) < new Date()) return <div className="card"><h1>Invitation expired</h1><Alert tone="warn">This invitation expired. Ask the administrator of {inv.tname} to send a new one.</Alert></div>;
  const mismatch = ctx && ctx.user.email.toLowerCase() !== inv.email.toLowerCase();
  return (
    <div className="card"><h1>Join {inv.tname}</h1>
      <p className="muted">You were invited as <strong>{inv.rname}</strong> using <strong>{inv.email}</strong>.</p>
      {mismatch ? <Alert tone="warn">You are signed in as {ctx!.user.email}. Sign out and reopen this link to accept as {inv.email}.</Alert>
        : inv.has_user && !ctx ? <><Alert tone="info">An account already exists for this email. Sign in first, then reopen this link.</Alert><Link className="btn primary" href={`/login?next=${encodeURIComponent("/invite/" + token)}`}>Sign in</Link></>
        : <ActionForm action={acceptInviteAction} submit={inv.has_user ? "Join company" : "Create account and join"} guard={false}>
            <input type="hidden" name="token" value={token} />
            {!inv.has_user && <><Field name="name" label="Your name" required /><Field name="password" label="Choose a password" type="password" required autoComplete="new-password" hint="At least 10 characters with letters and a number." /></>}
          </ActionForm>}
    </div>
  );
}
