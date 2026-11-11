import { createHmac } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

/** Signature header value: `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<body>">`. Receivers should reject old timestamps. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Minutes to wait after the nth failed attempt (1-based). Mirrors public.record_webhook_result. */
export const backoffMinutes = (attempt: number) => Math.min(2 ** (attempt - 1), 360);

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (mapped) return isPrivateIp(mapped[1]!);
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith("ff");
  }
  return true; // not an IP at all: treat as unsafe
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };
/** Syntactic checks done before any network access. */
export function checkWebhookUrl(raw: string): UrlCheck {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "not a valid URL" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "only https URLs are allowed" };
  if (u.username || u.password) return { ok: false, reason: "credentials in the URL are not allowed" };
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return { ok: false, reason: "internal host names are not allowed" };
  if (net.isIP(h) && isPrivateIp(h)) return { ok: false, reason: "private or reserved addresses are not allowed" };
  return { ok: true, url: u };
}

export type Delivery = { id: string; url: string; secret: string; event_id: string; event_type: string; payload: unknown; attempts: number };
export type Outcome = { ok: boolean; status: number | null; error: string | null };

/** Resolves the host, refuses private targets, and connects to the *validated* address (no second lookup, so no DNS rebinding). */
export async function deliver(d: Delivery, opts: { timeoutMs?: number; now?: () => number } = {}): Promise<Outcome> {
  const chk = checkWebhookUrl(d.url);
  if (!chk.ok) return { ok: false, status: null, error: chk.reason };
  const u = chk.url;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addr: { address: string; family: number };
  try {
    const all = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
    if (!all.length) return { ok: false, status: null, error: "host did not resolve" };
    if (all.some((a) => isPrivateIp(a.address))) return { ok: false, status: null, error: "host resolves to a private address" };
    addr = all[0]!;
  } catch (e) { return { ok: false, status: null, error: `dns: ${(e as Error).message}`.slice(0, 200) }; }

  const body = JSON.stringify(d.payload);
  const ts = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  return await new Promise<Outcome>((resolve) => {
    const req = https.request({
      host: addr.address, servername: host, port: u.port || 443, path: u.pathname + u.search, method: "POST", timeout: opts.timeoutMs ?? 5000,
      headers: { host: u.host, "content-type": "application/json", "content-length": Buffer.byteLength(body), "user-agent": "BERP-Webhooks/1", "x-berp-event": d.event_type, "x-berp-delivery": d.id, "x-berp-signature": signWebhook(d.secret, ts, body) },
    }, (res) => {
      res.resume(); // body is ignored; never followed or stored
      const s = res.statusCode ?? 0;
      resolve({ ok: s >= 200 && s < 300, status: s, error: s >= 200 && s < 300 ? null : `HTTP ${s}` });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: null, error: "timed out after 5s" }); });
    req.on("error", (e) => resolve({ ok: false, status: null, error: e.message.slice(0, 200) }));
    req.end(body);
  });
}
