import { NextResponse } from "next/server";
import { runDueJobs, enqueue } from "@/lib/server/jobs";
import { safeEqualHex, sha256 } from "@/lib/server/crypto";
export const dynamic = "force-dynamic";
/** Scheduler hook: call every minute with `Authorization: Bearer $CRON_SECRET` if you do not run `npm run worker`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET; const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || !safeEqualHex(sha256(got), sha256(secret))) return new NextResponse("Unauthorized", { status: 401 });
  await enqueue("renewals_scan", {}, `renewals:${new Date().toISOString().slice(0, 13)}`);
  return NextResponse.json(await runDueJobs(50));
}
