"use server";
import { tenantAction, type ActionResult } from "@/lib/actions";
export async function markAllReadAction(): Promise<ActionResult> {
  return tenantAction("masters.view", null, async (ctx, db) => { await db.query("update notifications set read_at=now() where tenant_id=$1 and user_id=$2 and read_at is null", [ctx.tenant.id, ctx.user.id]); return { ok: true }; }, { allowReadOnly: true });
}
