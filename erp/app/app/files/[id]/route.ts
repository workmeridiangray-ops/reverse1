import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/session";
import { withTenant } from "@/lib/db";

// Tenant-scoped download: the row is only visible through RLS for the caller's company, so a guessed id from another company returns 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx?.tenant || !ctx.membership || ctx.mfaOk === false) return new NextResponse("Not signed in", { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const f = await withTenant(ctx.tenant.id, async (db) => (await db.query("select filename, mime, data, owner_type from files where id=$1 and tenant_id=$2", [id, ctx.tenant!.id])).rows[0], { readOnly: true });
  if (!f) return new NextResponse("Not found", { status: 404 });
  const need = ({ dispatch: "inventory.view", expense: "finance.view" } as Record<string, string>)[f.owner_type] ?? "masters.view";
  if (!ctx.perms.has(need)) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(f.data, { headers: { "content-type": f.mime, "content-disposition": `attachment; filename="${f.filename}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
