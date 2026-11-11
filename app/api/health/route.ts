import { NextResponse } from "next/server";
import { plat } from "@/lib/server/db";
export const dynamic = "force-dynamic";
/** Liveness + database readiness for load balancers and uptime monitors. */
export async function GET() {
  try { const r = await plat("select now() t, (select count(*)::int from jobs where status='dead') dead"); return NextResponse.json({ status: "ok", db: "up", deadJobs: r.rows[0].dead, time: r.rows[0].t }); }
  catch { return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 }); }
}
