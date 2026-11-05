import "server-only";
import { plat } from "./db";
import { enqueue } from "./jobs";

export const APP_URL = () => process.env.APP_URL ?? "http://localhost:3000";
/** Emails are written to the outbox in the caller's flow and sent by the worker, with retries. */
export async function sendEmail(to: string, subject: string, body: string, companyId?: string | null) {
  const r = await plat("insert into email_outbox(company_id,to_email,subject,body) values ($1,$2,$3,$4) returning id", [companyId ?? null, to, subject, body]);
  await enqueue("send_email", { id: r.rows[0].id }, `email:${r.rows[0].id}`);
}
/** Delivers via the configured transactional provider (Resend-compatible HTTP API). EMAIL_PROVIDER=log keeps messages in the outbox only (dev/test). */
export async function deliver(id: string) {
  const m = (await plat("select * from email_outbox where id=$1", [id])).rows[0];
  if (!m || m.status === "sent") return;
  const mode = process.env.EMAIL_PROVIDER ?? "log";
  try {
    if (mode === "resend") {
      if (!process.env.EMAIL_API_KEY || !process.env.EMAIL_FROM) throw new Error("EMAIL_API_KEY / EMAIL_FROM not configured");
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.to_email], subject: m.subject, text: m.body }) });
      if (!res.ok) throw new Error(`provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } else if (mode !== "log") throw new Error(`Unknown EMAIL_PROVIDER ${mode}`);
    await plat("update email_outbox set status='sent', sent_at=now(), attempts=attempts+1 where id=$1", [id]);
  } catch (e) {
    await plat("update email_outbox set attempts=attempts+1, last_error=$2, status=case when attempts+1>=5 then 'failed' else 'queued' end where id=$1", [id, String(e)]);
    throw e;
  }
}
