import { NextResponse } from "next/server";
import { receiveWebhook } from "@/lib/server/billing";
export const dynamic = "force-dynamic";
/** Payment provider callback. Verified by HMAC signature over the raw body; recorded once per event id; processed by the job worker with retries. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 200_000) return new NextResponse("Too large", { status: 413 });
  const r = await receiveWebhook(raw, req.headers.get("x-razorpay-signature") ?? req.headers.get("x-signature"));
  return NextResponse.json({ ok: r.status === 200, duplicate: (r as any).duplicate ?? false }, { status: r.status });
}
