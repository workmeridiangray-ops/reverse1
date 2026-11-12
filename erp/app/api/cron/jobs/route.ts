import { NextResponse } from "next/server";
import { processJobs } from "@/lib/jobs";
import { billingSweep } from "@/lib/billing";
import { env } from "@/lib/env";
import "@/lib/email"; import "@/lib/webhooks";
import { timingSafeEqual } from "node:crypto";

// Call every minute from a scheduler: Authorization: Bearer $CRON_SECRET
export async function POST(req: Request) {
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, "")), want = Buffer.from(env.cronSecret);
  if (!want.length || given.length !== want.length || !timingSafeEqual(given, want)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const sweep = url.searchParams.get("sweep") === "1" ? await billingSweep() : undefined;
  return NextResponse.json({ jobs: await processJobs(50), sweep });
}
