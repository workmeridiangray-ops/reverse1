import "server-only";
import type { Db } from "./db";
import { audit } from "./audit";
import { UserError } from "./errors";
import type { Ctx } from "./auth/session";
import { revokeUserSessions } from "./auth/session";

export const label = (c: Ctx) => `${c.user.name} (platform ${c.user.platformRole})`;
export async function setTenantStatus(db: Db, c: Ctx, tenantId: string, status: "suspended" | "active", reason: string) {
  if (reason.trim().length < 5) throw new UserError("A reason is required.", { reason: "Required" });
  const t = (await db.query("select * from tenants where id=$1 for update", [tenantId])).rows[0]; if (!t) throw new UserError("Company not found");
  if (status === "suspended") {
    await db.query("update tenants set status='suspended', suspended_reason=$2 where id=$1", [tenantId, reason]);
    const us = (await db.query("select user_id from memberships where tenant_id=$1", [tenantId])).rows; for (const u of us) await revokeUserSessions(db, u.user_id, tenantId);
  } else await db.query("update tenants set status='active', suspended_reason=null where id=$1", [tenantId]);
  await audit(db, { tenantId, actorUserId: c.user.id, actorLabel: label(c), action: `platform.tenant_${status}`, entityType: "tenant", entityId: tenantId, reason });
}
export async function refundPayment(db: Db, c: Ctx, paymentId: string, reason: string) {
  if (reason.trim().length < 5) throw new UserError("A reason is required.", { reason: "Required" });
  const p = (await db.query("select * from platform_payments where id=$1 for update", [paymentId])).rows[0];
  if (!p || p.status !== "succeeded") throw new UserError("Only succeeded payments can be refunded.");
  // Marks the refund in our books; the money movement itself is executed in the Razorpay dashboard/API and confirmed by webhook.
  await db.query("update platform_payments set status='refunded', refund_reason=$2 where id=$1", [paymentId, reason]);
  await db.query("update platform_invoices set status='refunded' where id=$1", [p.invoice_id]);
  await audit(db, { tenantId: p.tenant_id, actorUserId: c.user.id, actorLabel: label(c), action: "platform.refund_recorded", entityType: "platform_payment", entityId: paymentId, reason });
}
