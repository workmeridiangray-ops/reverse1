import type { Q } from './db';
/** Audit entries hold ids, field names and reasons. Never passwords, tokens or document content. */
export async function audit(q: Q, a: { orgId: string | null; actorId: string | null; role?: string; action: string; entity?: string; entityId?: string; detail?: Record<string, unknown>; ip?: string | null }) {
  await q.query(
    `insert into audit_log(org_id, actor_id, actor_role, action, entity, entity_id, detail, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.orgId, a.actorId, a.role ?? null, a.action, a.entity ?? null, a.entityId ?? null, JSON.stringify(a.detail ?? {}), a.ip ?? null],
  );
}
export async function notify(q: Q, orgId: string, userIds: string[], title: string, body: string, link?: string) {
  for (const uid of [...new Set(userIds)].filter(Boolean)) {
    await q.query('insert into notifications(org_id,user_id,title,body,link) values ($1,$2,$3,$4,$5)', [orgId, uid, title, body, link ?? null]);
  }
}
