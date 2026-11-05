import { createClient } from "@/lib/supabase/server";
import { requireCtx, can } from "@/lib/session";
import { toCsv } from "@/lib/rules/csv";
import { REPORTS, loadReport } from "../defs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireCtx();
  if (!can(ctx.role, "owner", "manager", "accountant", "viewer")) return new Response("Forbidden", { status: 403 });
  const key = new URL(req.url).searchParams.get("r") ?? "ar";
  const def = REPORTS.find((r) => r.key === key);
  if (!def) return new Response("Unknown report", { status: 404 });
  const rows = await loadReport(await createClient(), key);
  const body = toCsv(def.columns.map((c) => c.label), rows.map((r) => def.columns.map((c) => (c.type === "money" ? (Number(r[c.key]) / 100).toFixed(2) : r[c.key]))));
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${def.key}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
