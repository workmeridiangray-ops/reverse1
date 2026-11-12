import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/session";
import { TEMPLATES } from "@/lib/erp/import";
import { toCsv } from "@/lib/csv";
export async function GET(_r: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx(); if (!ctx?.tenant) return new NextResponse("Not signed in", { status: 401 });
  const t = TEMPLATES[(await params).kind]; if (!t) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(toCsv(t.header, [t.example]), { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="${(await params).kind}-template.csv"` } });
}
