// Sends queued email with bounded retries (5 attempts, exponential backoff). Run continuously or from cron:
//   node scripts/worker.mjs            (loop)     node scripts/worker.mjs --once
// EMAIL_MODE=log prints instead of sending; EMAIL_MODE=brevo needs BREVO_API_KEY and MAIL_FROM.
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2 });
const mode = process.env.EMAIL_MODE ?? "log";
const from = process.env.MAIL_FROM ?? "SiteLedger <no-reply@example.com>";

async function send(m) {
  if (mode === "log") { console.log(`[email] to=${m.to_email} subject=${m.subject}`); return; }
  if (mode !== "brevo") throw new Error(`unknown EMAIL_MODE ${mode}`);
  const sender = /^(.*)<(.+)>$/.exec(from);
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": process.env.BREVO_API_KEY ?? "", "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: sender?.[1]?.trim() || "SiteLedger", email: sender?.[2] ?? from }, to: [{ email: m.to_email }], subject: m.subject, textContent: m.body }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function tick() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query("SELECT * FROM email_outbox WHERE status='pending' AND next_attempt_at <= now() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED");
    for (const m of rows) {
      try { await send(m); await c.query("UPDATE email_outbox SET status='sent', sent_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1", [m.id]); }
      catch (e) {
        const attempts = m.attempts + 1;
        await c.query("UPDATE email_outbox SET attempts=$2, last_error=$3, status=$4, next_attempt_at=now() + ($5 || ' seconds')::interval WHERE id=$1",
          [m.id, attempts, String(e.message).slice(0, 300), attempts >= 5 ? "failed" : "pending", String(30 * 2 ** attempts)]);
      }
    }
    await c.query("COMMIT");
    return rows.length;
  } catch (e) { await c.query("ROLLBACK"); console.error(e); return 0; } finally { c.release(); }
}
if (process.argv.includes("--once")) { console.log("processed", await tick()); await pool.end(); }
else for (;;) { await tick(); await new Promise((r) => setTimeout(r, 10_000)); }
