import Link from 'next/link';
import ActionForm from '@/components/ActionForm';
import { Field, Alert } from '@/components/ui';
import { acceptInviteAction } from '@/app/actions/auth';
import { withSystem } from '@/lib/db';
import { lookupInvite } from '@/lib/identity';
import { getSession } from '@/lib/session';
export const metadata = { title: 'Invitation · Buildline' };
export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await withSystem(q => lookupInvite(q, token));
  const s = await getSession();
  if (r.state !== 'ok') {
    const msg = { expired: 'This invitation has expired. Ask the sender to invite you again.', revoked: 'This invitation was cancelled by the sender (or replaced by a newer one). Check your inbox for the latest link.', used: 'This invitation has already been used. Just sign in.', invalid: 'This invitation link is not valid.' }[r.state];
    return <><h1>Invitation unavailable</h1><div className="mt-3"><Alert kind="bad">{msg}</Alert></div><p className="mt-4"><Link className="btn btn-primary" href="/login">Sign in</Link></p></>;
  }
  const inv = r.invite;
  const existing = await withSystem(async q => (await q.query('select 1 from users where lower(email) = $1', [inv.email])).rowCount);
  return (
    <>
      <h1>Join {inv.org_name}</h1>
      <p className="text-muted mt-1 mb-4">You were invited as <strong>{inv.role}</strong> using <strong>{inv.email}</strong>.</p>
      {existing ? (
        s ? <ActionForm action={acceptInviteAction} submit={`Join ${inv.org_name}`}><input type="hidden" name="token" value={token} /><input type="hidden" name="existing" value="1" /><p className="text-sm">Signed in as {s.user.email}.</p></ActionForm>
          : <><Alert kind="info">You already have a Buildline account. Sign in, then open this link again.</Alert><p className="mt-4"><Link className="btn btn-primary" href={`/login?next=/invite/${token}`}>Sign in</Link></p></>
      ) : (
        <ActionForm action={acceptInviteAction} submit="Create account & join">
          <input type="hidden" name="token" value={token} />
          <Field label="Your name" name="name"><input id="name" name="name" className="input" required autoComplete="name" /></Field>
          <Field label="Password" name="password" help="At least 10 characters, with letters and a number."><input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" /></Field>
        </ActionForm>
      )}
    </>
  );
}
