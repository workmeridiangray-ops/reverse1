import "server-only";
import { plat } from "./db";
import { ROLE_PERMS, type Perm, type Role } from "./perms";
/** In-app notification to every active member whose role holds `perm` (respecting their in-app preference). */
export async function notifyPerm(companyId: string, perm: Perm, title: string, href?: string, body?: string, excludeUserId?: string) {
  const roles = (Object.keys(ROLE_PERMS) as Role[]).filter((r) => ROLE_PERMS[r].includes(perm));
  await plat(`insert into notifications(company_id,user_id,title,body,href)
    select $1, m.user_id, $3, $4, $5 from memberships m join users u on u.id=m.user_id
    where m.company_id=$1 and m.active and m.role = any($2::text[]) and ($6::uuid is null or m.user_id<>$6) and coalesce((u.notif_prefs->>'inapp')::boolean, true)`, [companyId, roles, title, body ?? null, href ?? null, excludeUserId ?? null]);
}
