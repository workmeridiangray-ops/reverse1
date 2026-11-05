import { mapRazorpayEvent, verifyRazorpaySignature } from "@/lib/billing";
import { serviceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Payment-provider webhook: verifies the HMAC over the raw body, then applies the event idempotently. */
export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  const raw = await req.text();
  if (!verifyRazorpaySignature(raw, req.headers.get("x-razorpay-signature"), secret)) return new Response("invalid signature", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const ev = mapRazorpayEvent(req.headers.get("x-razorpay-event-id"), body);
  if (!ev) return Response.json({ ignored: true });
  const { data, error } = await serviceClient().rpc("apply_provider_event", { p_event_id: ev.id, p_kind: ev.kind, p_tenant: ev.tenantId, p_plan: ev.plan, p_ref: ev.ref, p_cycle: ev.cycle });
  if (error) return new Response("processing failed", { status: 500 }); // provider retries; handler is idempotent
  return Response.json({ applied: data === true });
}
