import type { Db } from "./db";
import { enqueue, registerJob } from "./jobs";
import { env, isProd } from "./env";

export async function queueEmail(db: Db, m: { to: string; subject: string; text: string; tenantId?: string | null; dedupeKey?: string }) {
  await enqueue(db, "email", { to: m.to, subject: m.subject, text: m.text }, { tenantId: m.tenantId, dedupeKey: m.dedupeKey });
}

registerJob("email", async (p) => {
  if (!env.smtpUrl) {
    if (isProd) throw new Error("SMTP_URL is not configured; email cannot be delivered");
    console.log(`[email:dev-log] to=${p.to} subject=${p.subject}\n${p.text}`);
    return;
  }
  const nodemailer = await import("nodemailer");
  await nodemailer.createTransport(env.smtpUrl).sendMail({ from: env.mailFrom, to: p.to, subject: p.subject, text: p.text });
});
