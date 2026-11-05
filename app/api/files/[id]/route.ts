import { NextResponse } from "next/server";
import { getCtx } from "@/lib/server/auth";
import { readUpload } from "@/lib/server/storage";

export const dynamic = "force-dynamic";
/** Authenticated download. Tenant isolation and project/role visibility come from row-level security; a guessed id is a 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (c === "none") return new NextResponse("Sign in required", { status: 401 });
  if (c === "no-tenant" || c.tenant.locked) return new NextResponse("Forbidden", { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const f = await c.run(async (db) => {
    const f = await db.maybe<{ id: string; storage_key: string; mime: string; name: string; project_id: string | null }>("SELECT id,storage_key,mime,name,project_id FROM files WHERE id=$1", [id]);
    if (!f) return null;
    const rev = await db.maybe<{ id: string; status: string }>("SELECT id,status FROM drawing_revisions WHERE file_id=$1", [id]);
    if (rev) await db.exec("INSERT INTO drawing_distribution(tenant_id,project_id,revision_id,user_id,was_current) VALUES ($1,$2,$3,$4,$5)", [c.tenant.id, f.project_id, rev.id, c.user.id, rev.status === "approved"]);
    return { ...f, superseded: rev?.status === "superseded" };
  });
  if (!f) return new NextResponse("Not found", { status: 404 });
  const buf = await readUpload(f.storage_key);
  const inline = f.mime.startsWith("image/") || f.mime === "application/pdf";
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": f.mime, "Content-Length": String(buf.length), "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox", ...(f.superseded ? { "X-Drawing-Status": "SUPERSEDED" } : {}),
  } });
}
