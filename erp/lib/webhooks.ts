import "server-only";
import { createHmac } from "node:crypto";
import type { Db } from "./db";
import { withSystem } from "./db";
import { enqueue, registerJob } from "./jobs";

/** Queue an outbound event for every active endpoint of the company that subscribes to it. */
export async function emitEvent(db: Db, tenantId: string, type: string, data: object) {
  const eps = (await db.query("select id from webhook_endpoints where tenant_id=$1 and active and ($2 = any(events) or '*' = any(events))", [tenantId, type])).rows;
  for (const e of eps) {
    const d = (await db.query("insert into webhook_deliveries(tenant_id,endpoint_id,event_type,payload) values ($1,$2,$3,$4) returning id", [tenantId, e.id, type, JSON.stringify({ type, data, at: new Date().toISOString() })])).rows[0];
    await enqueue(db, "webhook_delivery", { id: d.id }, { tenantId, dedupeKey: `wh:${d.id}` });
  }
}
export const signBody = (secret: string, ts: string, body: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

registerJob("webhook_delivery", async (p) => {
  const row = await withSystem(async (db) => (await db.query("select d.*, e.url, e.secret, e.active from webhook_deliveries d join webhook_endpoints e on e.id=d.endpoint_id where d.id=$1", [p.id])).rows[0]);
  if (!row || row.status === "delivered") return;
  if (!row.active) { await withSystem((db) => db.query("update webhook_deliveries set status='failed', last_error='endpoint disabled' where id=$1", [row.id])); return; }
  if (process.env.NODE_ENV === "production" || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(row.url)) await assertPublicUrl(row.url);
  const body = JSON.stringify(row.payload), ts = String(Math.floor(Date.now() / 1000));
  let status = 0, err: string | null = null;
  try {
    const r = await fetch(row.url, { method: "POST", headers: { "content-type": "application/json", "x-ledgerline-event": row.event_type, "x-ledgerline-delivery": row.id, "x-ledgerline-timestamp": ts, "x-ledgerline-signature": signBody(row.secret, ts, body) }, body, signal: AbortSignal.timeout(8000), redirect: "manual" });
    status = r.status; if (!r.ok) err = `HTTP ${r.status}`;
  } catch (e: any) { err = e.message; }
  await withSystem((db) => db.query("update webhook_deliveries set attempts=attempts+1, last_status=$2, last_error=$3, status=$4, delivered_at=case when $4='delivered' then now() end where id=$1", [row.id, status || null, err, err ? "failed" : "delivered"]));
  if (err) throw new Error(err);
});

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
/** Blocks webhook targets that resolve to private, loopback or link-local addresses (SSRF). */
export async function assertPublicUrl(url: string): Promise<void> {
  let u: URL; try { u = new URL(url); } catch { throw new Error("Enter a valid URL"); }
  if (u.protocol !== "https:") throw new Error("Webhook URLs must use https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Error("That host name could not be resolved"); });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address) || /^(::1|fc|fd|fe80)/i.test(address) || address === "::") throw new Error("That address is not publicly reachable");
  }
}
