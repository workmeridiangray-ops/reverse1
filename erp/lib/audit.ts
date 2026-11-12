import type { Db } from "./db";

export interface AuditInput {
  tenantId?: string | null; actorUserId?: string | null; actorLabel?: string;
  action: string; entityType?: string; entityId?: string; detail?: Record<string, unknown>; reason?: string | null;
}
/** Append-only audit record written in the same transaction as the change it describes. */
export async function audit(db: Db, a: AuditInput): Promise<void> {
  await db.query(
    `insert into audit_log(tenant_id, actor_user_id, actor_label, action, entity_type, entity_id, detail, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.tenantId ?? null, a.actorUserId ?? null, a.actorLabel ?? null, a.action, a.entityType ?? null, a.entityId ?? null, JSON.stringify(a.detail ?? {}), a.reason ?? null],
  );
}
