import pg from 'pg';
import { withSystem, withTenant, pool, type Ctx, type Q } from '@/lib/db';
import { signUp } from '@/lib/identity';

export { withTenant, withSystem, pool };
export const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });

export async function makeOrg(tag: string) {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.example`;
  const r = await withSystem(q => signUp(q, { name: `Owner ${tag}`, email, password: 'correct-horse-9', company: `Company ${tag}`, appUrl: 'http://x' }));
  const ctx: Ctx = { userId: r.userId, orgId: r.orgId, role: 'owner' };
  return { ...r, email, ctx };
}
export async function makeUser(orgId: string, role: string, projectId?: string, extra: Record<string, any> = {}) {
  return withSystem(async q => {
    const email = `u-${role}-${Math.random().toString(36).slice(2, 8)}@test.example`;
    const u = (await q.query(`insert into users(email, name, password_hash, email_verified_at) values ($1,$2,'x', now()) returning id`, [email, role])).rows[0];
    await q.query('insert into memberships(org_id, user_id, role, party_id) values ($1,$2,$3,$4)', [orgId, u.id, role, extra.partyId ?? null]);
    if (projectId) await q.query('insert into project_members(org_id, project_id, user_id, project_role, party_id, approval_limit_paise, authorities) values ($1,$2,$3,$4,$5,$6,$7)',
      [orgId, projectId, u.id, role, extra.partyId ?? null, extra.limit ?? 0, extra.authorities ?? []]);
    return { userId: u.id as string, email, ctx: { userId: u.id as string, orgId, role, partyId: extra.partyId ?? null } as Ctx };
  }, orgId);
}
export async function seedProject(ctx: Ctx, code = 'P1') {
  return withTenant(ctx, async q => {
    const p = (await q.query(`insert into projects(org_id, code, name, status, created_by) values ($1,$2,'Tower A','active',$3) returning id`, [ctx.orgId, code, ctx.userId])).rows[0];
    const site = (await q.query(`insert into wbs_nodes(org_id, project_id, kind, code, name) values ($1,$2,'site','S1','Main site') returning id`, [ctx.orgId, p.id])).rows[0];
    const boq = (await q.query(`insert into boq_items(org_id, project_id, code, description, unit, qty, rate_paise, budget_rate_paise) values ($1,$2,'A1','Concrete','m3',1000,500000,400000) returning id`, [ctx.orgId, p.id])).rows[0];
    return { projectId: p.id as string, siteId: site.id as string, boqId: boq.id as string };
  });
}
export const count = async (q: Q, table: string) => Number((await q.query(`select count(*) n from ${table}`)).rows[0].n);
