import { createHmac, timingSafeEqual } from "node:crypto";

/** Razorpay signs the raw webhook body with HMAC-SHA256 (hex) using the webhook secret. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ProviderEvent = { id: string; kind: "charged" | "failed" | "cancelled"; tenantId: string; plan: string | null; ref: string | null; cycle: "monthly" | "yearly" };

/** Maps a Razorpay webhook payload to our event. Returns null for events we deliberately ignore. */
export function mapRazorpayEvent(eventId: string | null, body: any): ProviderEvent | null {
  const sub = body?.payload?.subscription?.entity;
  const notes = sub?.notes ?? body?.payload?.payment?.entity?.notes ?? {};
  const kind = ({ "subscription.charged": "charged", "payment.failed": "failed", "subscription.halted": "failed", "subscription.cancelled": "cancelled", "subscription.completed": "cancelled" } as const)[body?.event as string];
  if (!kind || !eventId || !notes.tenant_id || !/^[0-9a-f-]{36}$/i.test(String(notes.tenant_id))) return null;
  return { id: eventId, kind, tenantId: String(notes.tenant_id), plan: notes.plan ? String(notes.plan) : null, ref: sub?.id ?? null, cycle: notes.cycle === "yearly" ? "yearly" : "monthly" };
}
