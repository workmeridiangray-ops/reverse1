import { NextResponse } from "next/server";
import { tx } from "@/lib/server/db";

export const dynamic = "force-dynamic";
/** Liveness + database readiness. No secrets, no tenant data. */
export async function GET() {
  try {
    const r = await tx({}, (db) => db.one<{ ok: number }>("SELECT 1 AS ok"));
    return NextResponse.json({ status: "ok", db: r.ok === 1 ? "up" : "down", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
