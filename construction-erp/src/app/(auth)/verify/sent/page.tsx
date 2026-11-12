import ActionForm from '@/components/ActionForm';
import { Field, Alert } from '@/components/ui';
import { resendVerificationAction } from '@/app/actions/auth';
import { env } from '@/lib/env';
import { withSystem, one } from '@/lib/db';
export default async function Sent({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email = '' } = await searchParams;
  // Local development only: with no mail provider configured, show where the message was queued.
  let devLink: string | null = null;
  if (!env.isProd && !env.resendKey && email) {
    const m = await withSystem(q => one<any>(q, `select body from email_outbox where lower(to_email) = lower($1) and subject like 'Verify%' order by created_at desc limit 1`, [email]));
    devLink = m?.body.match(/https?:\/\/\S+/)?.[0] ?? null;
  }
  return (
    <>
      <h1>Check your inbox</h1>
      <p className="text-muted mt-2 mb-4">We sent a confirmation link{email ? <> to <strong>{email}</strong></> : ''}. It expires in 2 days.</p>
      {devLink && <Alert kind="warn" title="Development mode — no email provider configured">Open <a href={devLink}>this verification link</a>.</Alert>}
      <div className="mt-5"><ActionForm action={resendVerificationAction} submit="Resend link" submitClass="btn">
        <Field label="Email" name="email"><input id="email" name="email" type="email" className="input" defaultValue={email} required /></Field>
      </ActionForm></div>
    </>
  );
}
