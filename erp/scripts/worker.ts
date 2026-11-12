import { processJobs } from "../lib/jobs";
import { billingSweep } from "../lib/billing";
import "../lib/email"; import "../lib/webhooks";
// Long-running worker: jobs every 5s, billing sweep every 10 minutes. Safe to run several (jobs use SKIP LOCKED).
let last = 0;
async function tick() {
  try { const r = await processJobs(50); if (r.done || r.failed) console.log(new Date().toISOString(), "jobs", r); if (Date.now() - last > 600_000) { last = Date.now(); console.log("sweep", await billingSweep()); } } catch (e) { console.error("worker error", e); }
}
console.log("worker started");
setInterval(tick, 5000); void tick();
