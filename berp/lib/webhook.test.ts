import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { backoffMinutes, checkWebhookUrl, deliver, isPrivateIp, signWebhook } from "./webhook";

describe("webhook signing and safety", () => {
  test("signature is t=<ts>,v1=hmac(secret, ts.body) and changes with any input", () => {
    const body = '{"a":1}';
    const sig = signWebhook("whsec_x", 1700000000, body);
    expect(sig).toBe(`t=1700000000,v1=${createHmac("sha256", "whsec_x").update(`1700000000.${body}`).digest("hex")}`);
    expect(signWebhook("whsec_y", 1700000000, body)).not.toBe(sig);
    expect(signWebhook("whsec_x", 1700000001, body)).not.toBe(sig);
    expect(signWebhook("whsec_x", 1700000000, body + " ")).not.toBe(sig);
  });
  test("backoff doubles from 1 minute and caps at 6 hours", () => {
    expect([1, 2, 3, 4, 8, 9, 20].map(backoffMinutes)).toEqual([1, 2, 4, 8, 128, 256, 360]);
  });
  test("private, loopback, link-local and reserved addresses are refused (v4, v6, mapped)", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  test("URL checks: https only, no credentials, no internal names or literal private IPs", () => {
    expect(checkWebhookUrl("https://hooks.example.com/berp?x=1").ok).toBe(true);
    for (const u of ["http://example.com", "ftp://x.com", "https://u:p@example.com", "https://localhost/x", "https://api.internal/x", "https://foo.local/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://10.0.0.5/x", "nonsense"])
      expect(checkWebhookUrl(u).ok, u).toBe(false);
  });
  test("deliver refuses a private target without opening a connection", async () => {
    const r = await deliver({ id: "d", url: "https://127.0.0.1/hook", secret: "s", event_id: "e", event_type: "x", payload: {}, attempts: 1 });
    expect(r).toMatchObject({ ok: false, status: null });
    expect(r.error).toMatch(/private/);
    expect((await deliver({ id: "d", url: "http://example.com/x", secret: "s", event_id: "e", event_type: "x", payload: {}, attempts: 1 })).error).toMatch(/https/);
  });
});
