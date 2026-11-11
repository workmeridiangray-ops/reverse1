// Background worker: node --experimental-strip-types is not required; uses the built HTTP cron endpoint to stay on one code path.
const base = process.env.APP_URL || "http://localhost:3000", secret = process.env.CRON_SECRET;
if (!secret) { console.error("CRON_SECRET required"); process.exit(1); }
async function tick() {
  try { const r = await fetch(base + "/api/cron", { method: "POST", headers: { Authorization: "Bearer " + secret } }); if (!r.ok) console.error("cron", r.status); else console.log(new Date().toISOString(), await r.text()); }
  catch (e) { console.error("worker error", String(e)); }
}
console.log("worker started →", base); await tick(); setInterval(tick, 30_000);
