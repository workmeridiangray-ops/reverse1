import crypto from 'node:crypto';
import { env } from './env';

/** Provider abstraction for SaaS subscription payments (INR). Razorpay in production, "test" mode locally. */
export interface Order { id: string; amountPaise: bigint; provider: string; checkoutUrl: string | null }

export async function createOrder(amountPaise: bigint, receipt: string): Promise<Order> {
  if (env.paymentMode === 'razorpay') {
    if (!env.razorpayKeyId || !env.razorpayKeySecret) throw new Error('Razorpay keys are not configured');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64') },
      body: JSON.stringify({ amount: Number(amountPaise), currency: 'INR', receipt }),
    });
    if (!r.ok) throw new Error(`Razorpay order failed (${r.status})`);
    const j = await r.json();
    return { id: j.id, amountPaise, provider: 'razorpay', checkoutUrl: null };
  }
  return { id: `test_order_${crypto.randomUUID()}`, amountPaise, provider: 'test', checkoutUrl: null };
}

/** Razorpay signs the raw webhook body with HMAC-SHA256 using the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret = env.razorpayWebhookSecret): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function signWebhook(rawBody: string, secret: string) { return crypto.createHmac('sha256', secret).update(rawBody).digest('hex'); }
