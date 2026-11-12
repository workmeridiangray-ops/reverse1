import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

export interface CheckoutInvoice { id: string; number: string; totalPaise: number; tenantName: string; email: string }
export type Checkout =
  | { kind: "redirect"; url: string }
  | { kind: "razorpay"; keyId: string; orderId: string; amount: number; name: string; email: string };
export interface PaymentEvent { id: string; type: "payment.succeeded" | "payment.failed" | "payment.refunded" | "payment.disputed" | "ignored"; invoiceId?: string; paymentId?: string; amount?: number; reason?: string; raw: unknown }

const hmac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function createCheckout(inv: CheckoutInvoice): Promise<Checkout> {
  if (env.billingProvider === "test") return { kind: "redirect", url: `/billing/test-checkout?invoice=${inv.id}` };
  if (!env.razorpayKeyId || !env.razorpayKeySecret) throw new Error("Razorpay keys are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64") },
    body: JSON.stringify({ amount: inv.totalPaise, currency: "INR", receipt: inv.number, notes: { invoice_id: inv.id } }),
  });
  if (!res.ok) throw new Error(`Razorpay order creation failed (${res.status})`);
  const order = await res.json();
  return { kind: "razorpay", keyId: env.razorpayKeyId, orderId: order.id, amount: inv.totalPaise, name: inv.tenantName, email: inv.email };
}

export function verifyWebhook(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = env.billingProvider === "test" ? env.testWebhookSecret : env.razorpayWebhookSecret;
  if (!secret) return false;
  return safeEq(hmac(secret, rawBody), signature);
}
export const signTestPayload = (body: string) => hmac(env.testWebhookSecret, body);

/** Verifies the signature Razorpay Checkout returns to the browser (order_id|payment_id). */
export function verifyRazorpayCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  return safeEq(hmac(env.razorpayKeySecret, `${orderId}|${paymentId}`), signature);
}

export function parseEvent(raw: any, headerEventId: string | null): PaymentEvent {
  if (env.billingProvider === "test") {
    return { id: raw.id, type: raw.type, invoiceId: raw.invoiceId, paymentId: raw.paymentId, amount: raw.amount, reason: raw.reason, raw };
  }
  const p = raw?.payload?.payment?.entity, r = raw?.payload?.refund?.entity, d = raw?.payload?.dispute?.entity;
  const id = headerEventId ?? raw?.id ?? `${raw?.event}:${p?.id ?? r?.id ?? d?.id}`;
  switch (raw?.event) {
    case "payment.captured": return { id, type: "payment.succeeded", invoiceId: p?.notes?.invoice_id, paymentId: p?.id, amount: p?.amount, raw };
    case "payment.failed": return { id, type: "payment.failed", invoiceId: p?.notes?.invoice_id, paymentId: p?.id, amount: p?.amount, reason: p?.error_description, raw };
    case "refund.processed": return { id, type: "payment.refunded", paymentId: r?.payment_id, amount: r?.amount, raw };
    case "payment.dispute.created": return { id, type: "payment.disputed", paymentId: d?.payment_id, raw };
    default: return { id, type: "ignored", raw };
  }
}
