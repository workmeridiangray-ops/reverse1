/** Runs SQL as a real signed-in user: role `authenticated` + request.jwt.claims, as PostgREST does. */
import pg from "pg";

pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: process.env.BERP_DB_URL, max: 4 });

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const U = {
  ownerA: uid(1), managerA: uid(2), salesA: uid(3), purchA: uid(4), whA: uid(5), acctA: uid(6), viewerA: uid(7),
  ownerB: uid(11), platform: uid(90), outsider: uid(99),
} as const;
export type UserKey = keyof typeof U;

export type Client = {
  q: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Runs a statement expected to fail inside a savepoint; returns the error message ('' if it succeeded). */
  err: (sql: string, params?: unknown[]) => Promise<string>;
};

/** Runs fn inside a transaction as `user`. Rolls back unless commit is true. */
export async function as<T>(user: UserKey, fn: (c: Client) => Promise<T>, commit = false): Promise<T> {
  const conn = await pool.connect();
  try {
    await conn.query("begin");
    await conn.query("set local role authenticated");
    await conn.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[user], role: "authenticated" })]);
    const out = await fn({
      q: async (sql, params) => (await conn.query(sql, params as unknown[])).rows as never,
      err: async (sql, params) => {
        await conn.query("savepoint s");
        try { await conn.query(sql, params as unknown[]); await conn.query("release savepoint s"); return ""; }
        catch (e) { await conn.query("rollback to savepoint s"); return (e as Error).message; }
      },
    });
    await conn.query(commit ? "commit" : "rollback");
    return out;
  } catch (e) {
    await conn.query("rollback").catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/** Expect a statement to fail; returns the message. Uses a savepoint-free fresh transaction. */
export async function fails(user: UserKey, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await as(user, (c) => c.q(sql, params));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected failure: ${sql}`);
}

export async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

export const TENANT = { A: "", B: "" };
export const WH = { A: "", A2: "" };
export const ITEM: Record<string, string> = {};
export const CUST: Record<string, string> = {};
export const SUP: Record<string, string> = {};

/** Seeds two tenants (A has the full role set) once per test file; committed, idempotent. */
export async function seed() {
  const have = await admin("select 1 from auth.users limit 1");
  if (have.length === 0) {
    for (const [k, id] of Object.entries(U)) await admin("insert into auth.users (id, email) values ($1,$2)", [id, `${k}@example.test`]);
    await admin("insert into public.platform_admins values ($1)", [U.platform]);
    await as("ownerA", async (c) => c.q("select public.create_workspace('Acme Traders')"), true);
    await as("ownerB", async (c) => c.q("select public.create_workspace('Bharat Supplies')"), true);
    await admin("update public.tenants set plan_code='growth', status='active'");
    const roles: [UserKey, string][] = [["managerA","manager"],["salesA","sales"],["purchA","purchasing"],["whA","warehouse"],["acctA","accountant"],["viewerA","viewer"]];
    for (const [k, r] of roles) await as("ownerA", (c) => c.q("select public.add_member($1,$2)", [U[k], r]), true);
    await as("ownerA", async (c) => {
      const t = (await c.q<{ id: string }>("select id from public.tax_codes where code='GST18'"))[0]!.id;
      await c.q("insert into public.items (tenant_id, sku, name, unit, sale_price_paise, cost_paise, tax_code_id) select app.tenant_id(), 'WID-1', 'Widget', 'nos', 100000, 60000, $1", [t]);
      await c.q("insert into public.items (tenant_id, sku, name, unit, sale_price_paise, cost_paise, tax_code_id) select app.tenant_id(), 'GAD-1', 'Gadget', 'nos', 25050, 15000, $1", [t]);
      await c.q("insert into public.items (tenant_id, sku, name, kind, sale_price_paise, tax_code_id) select app.tenant_id(), 'SVC-1', 'Installation', 'service', 500000, $1", [t]);
      await c.q("insert into public.customers (tenant_id, name, credit_limit_paise) select app.tenant_id(), 'Kiran Stores', 5000000");
      await c.q("insert into public.customers (tenant_id, name, credit_limit_paise) select app.tenant_id(), 'Tiny Shop', 100000");
      await c.q("insert into public.suppliers (tenant_id, name) select app.tenant_id(), 'Prime Components'");
    }, true);
  }
  TENANT.A = (await admin<{ id: string }>("select id from public.tenants where name='Acme Traders'"))[0]!.id;
  TENANT.B = (await admin<{ id: string }>("select id from public.tenants where name='Bharat Supplies'"))[0]!.id;
  WH.A = (await admin<{ id: string }>("select id from public.warehouses where tenant_id=$1", [TENANT.A]))[0]!.id;
  for (const r of await admin<{ id: string; sku: string }>("select id, sku from public.items where tenant_id=$1", [TENANT.A])) ITEM[r.sku] = r.id;
  for (const r of await admin<{ id: string; name: string }>("select id, name from public.customers where tenant_id=$1", [TENANT.A])) CUST[r.name] = r.id;
  for (const r of await admin<{ id: string; name: string }>("select id, name from public.suppliers where tenant_id=$1", [TENANT.A])) SUP[r.name] = r.id;
}
