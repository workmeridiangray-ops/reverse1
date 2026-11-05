import "server-only";
import type { Db } from "./db";
import { plat } from "./db";
export type Actor = { userId?: string | null; label?: string; companyId?: string | null; ip?: string | null };
/** Written inside the caller's transaction so an action and its audit record commit or fail together. */
export async function audit(c: Db, a: Actor, action: string, entity?: string, entityId?: string, detail: Record<string, unknown> = {}, reason?: string) {
  await c.query("insert into audit_log(company_id,user_id,actor_label,action,entity,entity_id,reason,detail,ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [a.companyId ?? null, a.userId ?? null, a.label ?? null, action, entity ?? null, entityId ?? null, reason ?? null, JSON.stringify(detail), a.ip ?? null]);
}
export async function auditPlat(a: Actor, action: string, entity?: string, entityId?: string, detail: Record<string, unknown> = {}, reason?: string) {
  await plat("insert into audit_log(company_id,user_id,actor_label,action,entity,entity_id,reason,detail,ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [a.companyId ?? null, a.userId ?? null, a.label ?? null, action, entity ?? null, entityId ?? null, reason ?? null, JSON.stringify(detail), a.ip ?? null]);
}
