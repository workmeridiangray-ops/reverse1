import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/payments';
import { withSystem } from '@/lib/db';
import { handlePaymentEvent } from '@/lib/domain/saas';
export const runtime = 'nodejs';
/** Razorpay webhook. Signature is verified against the raw body; handling is idempotent by event id, so provider retries are safe. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get('x-razorpay-signature'))) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  let body: any; try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const eventId = req.headers.get('x-razorpay-event-id') ?? body?.payload?.payment?.entity?.id ?? '';
  if (!eventId) return NextResponse.json({ error: 'missing event id' }, { status: 400 });
  try {
    const r = await withSystem(q => handlePaymentEvent(q, { provider: 'razorpay', eventId, type: body.event, payload: body.payload?.payment?.entity ?? body.payload }));
    return NextResponse.json({ status: r });
  } catch (e) { return NextResponse.json({ error: 'processing failed; will be retried' }, { status: 500 }); }   // non-2xx makes the provider retry
}
