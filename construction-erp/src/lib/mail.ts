import type { Q } from './db';
import { env } from './env';

/** Queue an email (transactional outbox). The worker delivers with retries. */
export async function queueMail(q: Q, to: string, subject: string, body: string, orgId: string | null = null) {
  await q.query('insert into email_outbox(to_email, subject, body, org_id) values ($1,$2,$3,$4)', [to, subject, body, orgId]);
}

/** Deliver one message. Resend when configured; otherwise logged (dev/test) — clearly reported, never silently "sent". */
export async function deliver(m: { to_email: string; subject: string; body: string }): Promise<'sent' | 'logged'> {
  if (!env.resendKey) {
    console.log(`[mail:dev] to=${m.to_email} subject=${m.subject}`);
    return 'logged';
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.mailFrom, to: m.to_email, subject: m.subject, text: m.body }),
  });
  if (!r.ok) throw new Error(`mail provider ${r.status}`);
  return 'sent';
}
