import "server-only";
import { registerJob } from "./jobs";
import { deliver } from "./mail";
import { processWebhookEvent, scanRenewals } from "./billing";
registerJob("send_email", async (p) => deliver(p.id));
registerJob("process_webhook", async (p) => processWebhookEvent(p.id));
registerJob("renewals_scan", async () => { await scanRenewals(); });
