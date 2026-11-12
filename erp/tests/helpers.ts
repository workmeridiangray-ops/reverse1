import { withSystem, withTenant, withTenantSystem, pool, type Db } from "@/lib/db";
import { provisionTenant } from "@/lib/tenancy";
import { startTrial } from "@/lib/billing";
import { hashPassword } from "@/lib/auth/password";
import type { TCtx } from "@/lib/actions";
import { SYSTEM_ROLES } from "@/lib/perms";

export interface Co { tenantId: string; userId: string; branchId: string; warehouseId: string; ctx: TCtx; other?: Co }
let n = 0;
export async function makeCompany(name = "Test Co", perms?: string[]): Promise<Co> {
  n++;
  return withSystem(async (db) => {
    const email = `owner${n}-${Date.now()}@test.example`;
    const u = (await db.query("insert into users(email,name,password_hash,email_verified_at) values ($1,'Owner',$2,now()) returning id", [email, await hashPassword("Password123!")])).rows[0].id;
    const t = (await db.query("insert into tenants(name,slug) values ($1,$2) returning id", [name, `t${n}-${Date.now()}`])).rows[0].id;
    await db.query("select set_config('app.tenant_id',$1,true)", [t]);
    const { branchId } = await provisionTenant(db, t, u, name);
    await startTrial(db, t);
    const wh = (await db.query("select id from warehouses where tenant_id=$1", [t])).rows[0].id;
    return { tenantId: t, userId: u, branchId, warehouseId: wh, ctx: ctxFor(t, u, name, perms ?? SYSTEM_ROLES.owner.permissions) };
  });
}
export function ctxFor(tenantId: string, userId: string, name: string, perms: string[]): TCtx {
  return { sessionId: "s", user: { id: userId, email: "x@y", name: "U", platformRole: null, totpEnabled: false }, mfaOk: true,
    tenant: { id: tenantId, name, slug: "x", status: "active", trialEndsAt: null, currency: "INR", setup: {}, branding: {} },
    membership: { id: "m", roleKey: "owner", roleName: "Owner", branchIds: null, customerId: null }, perms: new Set(perms), readOnlyReason: null, supportMode: false } as any;
}
export async function addUser(co: Co, roleKey: string): Promise<{ userId: string; ctx: TCtx }> {
  return withSystem(async (db) => {
    const u = (await db.query("insert into users(email,name,password_hash,email_verified_at) values ($1,'U',$2,now()) returning id", [`u${Math.random()}@t.example`, await hashPassword("Password123!")])).rows[0].id;
    const role = (await db.query("select id from roles where tenant_id=$1 and key=$2", [co.tenantId, roleKey])).rows[0].id;
    await db.query("insert into memberships(tenant_id,user_id,role_id) values ($1,$2,$3)", [co.tenantId, u, role]);
    return { userId: u, ctx: ctxFor(co.tenantId, u, "x", SYSTEM_ROLES[roleKey].permissions) };
  });
}
export const T = <X>(co: Co, fn: (db: Db) => Promise<X>) => withTenantSystem(co.tenantId, fn);
export async function seedCatalog(co: Co, opts: { stock?: number; creditLimit?: number } = {}) {
  return T(co, async (db) => {
    const tax = (await db.query("select id from tax_codes where tenant_id=$1 and code='GST18'", [co.tenantId])).rows[0].id;
    const item = (await db.query("insert into items(tenant_id,sku,name,sale_price_paise,purchase_price_paise,tax_code_id) values ($1,'SKU1','Widget',10000,6000,$2) returning id", [co.tenantId, tax])).rows[0].id;
    const cust = (await db.query("insert into customers(tenant_id,code,name,credit_limit_paise) values ($1,'C1','Acme Ltd',$2) returning id", [co.tenantId, opts.creditLimit ?? 0])).rows[0].id;
    const sup = (await db.query("insert into suppliers(tenant_id,code,name) values ($1,'S1','Parts Supplier') returning id", [co.tenantId])).rows[0].id;
    return { item, cust, sup, tax };
  });
}
export { pool, withTenant, withSystem };
