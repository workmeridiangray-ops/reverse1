import { NextResponse } from "next/server";
import { getAuth } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { readUpload } from "@/lib/server/files";
import { isPortal } from "@/lib/server/perms";
export const dynamic = "force-dynamic";
/** Authorised per request: tenant RLS decides existence; portal users additionally need the document shared with their party. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await getAuth(); const { id } = await params;
  if (!a || "expired" in a || !a.company || !a.membership) return new NextResponse("Sign in required", { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const doc = await tx(async (c) => (await c.query("select * from documents where id=$1", [id])).rows[0], { companyId: a.company.id, userId: a.user.id });
  if (!doc) return new NextResponse("Not found", { status: 404 });
  if (isPortal(a.membership.role)) {
    if (!doc.shared_with_party) return new NextResponse("Not found", { status: 404 });
    const ok = await tx(async (c) => (await c.query(`select 1 from documents d where d.id=$1 and (
      (d.entity='shipment' and exists (select 1 from shipments s where s.id=d.entity_id and s.customer_id=$2)) or
      (d.entity='sales_order' and exists (select 1 from sales_orders o where o.id=d.entity_id and o.customer_id=$2)) or
      (d.entity='purchase_order' and exists (select 1 from purchase_orders p where p.id=d.entity_id and p.supplier_id=$2)))`, [id, a.membership!.partyId])).rowCount, { companyId: a.company.id });
    if (!ok) return new NextResponse("Not found", { status: 404 });
  }
  try { const buf = await readUpload(doc.storage_key); return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": doc.mime, "Content-Disposition": `attachment; filename="${doc.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } }); }
  catch { return new NextResponse("File missing from storage", { status: 410 }); }
}
