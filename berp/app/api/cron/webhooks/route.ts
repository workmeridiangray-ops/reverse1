import { timingSafeEqual } from "node:crypto";
import { deliver, type Delivery } from "@/lib/webhook";
import { serviceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const authorised = (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Delivery worker. Call every minute (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). Safe to run concurrently. */
async function run(req: Request) {
  if (!authorised(req)) return new Response("unauthorised", { status: 401 });
  const sb = serviceClient();
  const { data, error } = await sb.rpc("claim_webhook_deliveries", { p_limit: 25 });
  if (error) return new Response("claim failed", { status: 500 });
  const rows = (data ?? []) as Delivery[];
  const results = await Promise.all(rows.map(async (d) => {
    const o = await deliver(d);
    await sb.rpc("record_webhook_result", { p_id: d.id, p_ok: o.ok, p_status: o.status, p_error: o.error });
    return o.ok;
  }));
  if (Math.random() < 0.01) await sb.rpc("purge_webhook_deliveries");
  return Response.json({ claimed: rows.length, delivered: results.filter(Boolean).length });
}
export const GET = run;
export const POST = run;
