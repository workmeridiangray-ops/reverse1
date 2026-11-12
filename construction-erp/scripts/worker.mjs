// Polls the app's job endpoint. Run as a separate process/service: `npm run worker`.
const url = (process.env.APP_URL ?? 'http://localhost:3100') + '/api/cron/tick';
const secret = process.env.CRON_SECRET;
if (!secret) { console.error('CRON_SECRET is required'); process.exit(1); }
const every = Number(process.env.WORKER_INTERVAL_MS ?? 15000);
for (;;) {
  try { const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } }); console.log(new Date().toISOString(), r.status, await r.text()); }
  catch (e) { console.error('tick failed', e.message); }
  await new Promise(r => setTimeout(r, every));
}
