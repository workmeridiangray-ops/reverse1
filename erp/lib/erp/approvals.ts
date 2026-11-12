import type { Db } from "../db";
import { UserError, AccessDenied } from "../errors";
import { audit } from "../audit";
import type { TCtx } from "../actions";

/** Highest-threshold active rule that the amount reaches. Rules apply at the time of submission; open requests keep their original routing. */
export async function ruleFor(db: Db, tenantId: string, entityType: string, amount: number) {
  return (await db.query(
    `select * from approval_rules where tenant_id=$1 and entity_type=$2 and status='active' and effective_from <= now() and min_amount_paise <= $3
      order by min_amount_paise desc limit 1`, [tenantId, entityType, amount])).rows[0] ?? null;
}

export async function requestApproval(db: Db, ctx: TCtx, a: { entityType: string; entityId: string; ref: string; amount: number; permission: string; impact?: object; link?: string }) {
  const approvers = (await db.query(
    `select m.user_id from memberships m join roles r on r.id=m.role_id where m.tenant_id=$1 and m.status='active' and $2 = any(r.permissions) and m.user_id <> $3`,
    [ctx.tenant.id, a.permission, ctx.user.id])).rows;
  if (!approvers.length) throw new UserError("No other active user can approve this (needs the “" + a.permission + "” permission). Invite an approver or adjust the approval rule.");
  const req = (await db.query(
    `insert into approval_requests(tenant_id,entity_type,entity_id,entity_ref,amount_paise,approver_permission,impact,requested_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.tenant.id, a.entityType, a.entityId, a.ref, a.amount, a.permission, JSON.stringify(a.impact ?? {}), ctx.user.id])).rows[0].id;
  for (const u of approvers) {
    await db.query("insert into notifications(tenant_id,user_id,title,body,link) values ($1,$2,$3,$4,$5)",
      [ctx.tenant.id, u.user_id, `Approval needed: ${a.ref}`, `${a.entityType.replace("_", " ")} awaiting your decision`, "/app/approvals"]);
  }
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "approval.requested", entityType: a.entityType, entityId: a.entityId, detail: { amount: a.amount, ref: a.ref } });
  return req as string;
}

type Handler = (db: Db, ctx: TCtx, entityId: string, approved: boolean, reason: string | null) => Promise<void>;
const handlers: Record<string, Handler> = {};
export function onDecision(entityType: string, h: Handler) { handlers[entityType] = h; }

export async function decide(db: Db, ctx: TCtx, requestId: string, approve: boolean, reason: string) {
  const r = (await db.query("select * from approval_requests where id=$1 for update", [requestId])).rows[0];
  if (!r) throw new UserError("Approval request not found");
  if (r.status !== "pending") throw new UserError(`This request was already ${r.status}.`);
  const delegatedOk = r.delegated_to === ctx.user.id;
  if (!ctx.perms.has(r.approver_permission) && !delegatedOk) throw new AccessDenied("You are not an approver for this request.");
  if (r.requested_by === ctx.user.id) throw new UserError("You cannot approve your own request (separation of duties).");
  if (!approve && reason.trim().length < 3) throw new UserError("A reason is required when rejecting.", { reason: "Required" });
  await db.query("update approval_requests set status=$2, decided_by=$3, decided_at=now(), reason=$4 where id=$1", [requestId, approve ? "approved" : "rejected", ctx.user.id, reason || null]);
  const h = handlers[r.entity_type];
  if (h) await h(db, ctx, r.entity_id, approve, reason || null);
  await db.query("insert into notifications(tenant_id,user_id,title,body,link) values ($1,$2,$3,$4,$5)",
    [ctx.tenant.id, r.requested_by, `${r.entity_ref} ${approve ? "approved" : "rejected"}`, reason || null, "/app/approvals"]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: approve ? "approval.approved" : "approval.rejected", entityType: r.entity_type, entityId: r.entity_id, reason: reason || null });
}
