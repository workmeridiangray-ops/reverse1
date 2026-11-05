import "server-only";
import pg from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __erpPool: pg.Pool | undefined;
}

// bigint columns arrive as strings; amounts and quantities fit safely in JS numbers (checked by rules).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(1082, (v) => v); // date as YYYY-MM-DD

export function pool(): pg.Pool {
  if (!globalThis.__erpPool) {
    const url = process.env.APP_DATABASE_URL;
    if (!url) throw new Error("APP_DATABASE_URL is not set");
    globalThis.__erpPool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: process.env.DB_SSL_INSECURE !== "true" } : undefined,
    });
  }
  return globalThis.__erpPool;
}

export interface Scope {
  tenantId?: string | null;
  userId?: string | null;
  role?: string | null;
  allProjects?: boolean;
  platform?: boolean;
  inviteLookup?: boolean;
}

export class Db {
  constructor(private c: pg.PoolClient) {}
  async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.c.query(sql, params)).rows as T[];
  }
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.q<T>(sql, params);
    if (rows.length !== 1) throw new NotFound();
    return rows[0] as T;
  }
  async maybe<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.q<T>(sql, params))[0] ?? null;
  }
  async exec(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.c.query(sql, params)).rowCount ?? 0;
  }
}

export class NotFound extends Error {
  override name = "NotFound";
  constructor() { super("Record not found"); }
}
/** Errors whose message is safe and useful to show to the user. */
export class UserError extends Error {
  override name = "UserError";
  constructor(message: string, public field?: string, public details?: string[]) { super(message); }
}

/** Run `fn` in one transaction with the row-level-security scope set for its duration. */
export async function tx<T>(scope: Scope, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true), set_config('app.role',$3,true),
              set_config('app.all_projects',$4,true), set_config('app.platform',$5,true), set_config('app.invite_lookup',$6,true),
              set_config('statement_timeout','15000',true)`,
      [scope.tenantId ?? "", scope.userId ?? "", scope.role ?? "", scope.allProjects === false ? "off" : "on",
       scope.platform ? "on" : "off", scope.inviteLookup ? "on" : "off"],
    );
    const result = await fn(new Db(client));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function audit(db: Db, userId: string | null, tenantId: string | null, action: string, entity?: string, entityId?: string, detail: Record<string, unknown> = {}) {
  await db.exec("INSERT INTO audit_log(tenant_id,user_id,action,entity,entity_id,detail) VALUES ($1,$2,$3,$4,$5,$6)", [
    tenantId, userId, action, entity ?? null, entityId ?? null, JSON.stringify(detail),
  ]);
}

export async function queueEmail(db: Db, tenantId: string | null, to: string, subject: string, body: string) {
  await db.exec("INSERT INTO email_outbox(tenant_id,to_email,subject,body) VALUES ($1,$2,$3,$4)", [tenantId, to, subject, body]);
}
