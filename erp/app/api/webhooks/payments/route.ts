import { NextResponse } from "next/server";
import { withSystem } from "@/lib/db";
import { verifyWebhook, parseEvent } from "@/lib/billing/provider";
import { enqueue, processJobs } from "@/lib/jobs";
import { env } from "@/lib/env";
import "@/lib/billing"; import "@/lib/email";

// Provider webhook: verify signature on the raw body, store once (dedupe on provider event id), process as a retryable job.
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? req.headers.get("x-signature");
  if (!verifyWebhook(raw, sig)) return new NextResponse("invalid signature", { status: 401 });
  let json: any; try { json = JSON.parse(raw); } catch { return new NextResponse("bad json", { status: 400 }); }
  const ev = parseEvent(json, req.headers.get("x-razorpay-event-id"));
  const id = await withSystem(async (db) => {
    const r = await db.query("insert into webhook_events(provider,event_id,payload) values ($1,$2,$3) on conflict (provider,event_id) do nothing returning id", [env.billingProvider, ev.id, JSON.stringify(json)]);
    if (!r.rows[0]) return null;   // duplicate delivery: already stored
    await enqueue(db, "payment_event", { webhookId: r.rows[0].id }, { dedupeKey: `pe:${r.rows[0].id}` });
    return r.rows[0].id as string;
  });
  if (id) await processJobs(10);
  return NextResponse.json({ ok: true, duplicate: !id });
}
