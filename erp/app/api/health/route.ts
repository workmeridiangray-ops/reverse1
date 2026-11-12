import { NextResponse } from "next/server";
import { withSystem } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const r = await withSystem(async (db) => ({ now: (await db.query("select now()")).rows[0].now, dead: Number((await db.query("select count(*) c from jobs where status='dead'")).rows[0].c), queued: Number((await db.query("select count(*) c from jobs where status in ('queued','failed') and run_at < now() - interval '15 minutes'")).rows[0].c) }));
    return NextResponse.json({ status: "ok", database: "up", deadJobs: r.dead, stuckJobs: r.queued });
  } catch { return NextResponse.json({ status: "degraded", database: "down" }, { status: 503 }); }
}
