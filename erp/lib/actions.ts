import "server-only";
import { z } from "zod";
import { withTenant, withTenantSystem, type Db } from "./db";
import { requireTenant, getCtx, type Ctx } from "./auth/session";
import { AccessDenied, ConflictError, PlanLimitError, UserError } from "./errors";

export type ActionResult = { ok: true; message?: string; redirectTo?: string } | { ok: false; error: string; fields?: Record<string, string> };
export type TCtx = Awaited<ReturnType<typeof requireTenant>>;

function isNextControl(e: any) { return typeof e?.digest === "string" && (e.digest.startsWith("NEXT_REDIRECT") || e.digest.startsWith("NEXT_NOT_FOUND")); }

export function fail(e: unknown): ActionResult {
  if (isNextControl(e)) throw e;
  if (e instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[String(i.path[0] ?? "form")] = i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fields };
  }
  if (e instanceof UserError) return { ok: false, error: e.message, fields: e.fields };
  if (e instanceof AccessDenied) return { ok: false, error: e.message };
  const pg = e as { code?: string; message?: string; constraint?: string };
  if (pg?.code === "23505") return { ok: false, error: "That already exists (duplicate value). Check the record and try again." };
  if (pg?.code === "23514" || pg?.code === "23000") return { ok: false, error: friendlyDb(pg.message ?? "") };
  if (pg?.code === "23503") return { ok: false, error: "A linked record is missing or belongs elsewhere." };
  if (pg?.code === "40001" || pg?.code === "40P01") return { ok: false, error: "Another change was happening at the same time. Please try again." };
  console.error("[action error]", e);
  return { ok: false, error: "Something went wrong and nothing was saved. Please try again; if it continues contact support." };
}
function friendlyDb(m: string): string {
  if (m.includes("closed")) return "That date falls in a closed financial period. Pick a date in an open period or ask an accountant to reopen it.";
  if (m.includes("no financial period")) return "No financial period covers that date. Add the period in Finance → Periods.";
  if (m.includes("not balanced")) return "The posting does not balance, so it was rejected.";
  if (m.includes("reserved") || m.includes("on_hand")) return "Not enough stock available for that operation.";
  if (m.includes("append-only") || m.includes("cannot be")) return m.replace(/^.*?: /, "");
  return "That change violates a business rule and was not saved.";
}

/**
 * Runs a tenant-scoped mutation: authenticates, checks permission, blocks read-only companies,
 * rejects duplicate submissions via an idempotency token, runs in ONE transaction, converts errors to results.
 */
export async function tenantAction(perm: string, form: FormData | null, fn: (ctx: TCtx, db: Db) => Promise<ActionResult | void>, opts: { allowReadOnly?: boolean } = {}): Promise<ActionResult> {
  try {
    const ctx = await requireTenant();
    if (!ctx.perms.has(perm)) throw new AccessDenied();
    if (ctx.readOnlyReason && !opts.allowReadOnly) throw new UserError(ctx.readOnlyReason);
    const token = form?.get("_token");
    const res = await withTenantSystem(ctx.tenant.id, async (db) => {
      if (typeof token === "string" && token) {
        const ins = await db.query("insert into idempotency_keys(key) values ($1) on conflict do nothing", [`${ctx.user.id}:${token}`]);
        if (!ins.rowCount) throw new UserError("This form was already submitted. Check the list before submitting again.");
      }
      return (await fn(ctx, db)) ?? ({ ok: true } as ActionResult);
    });
    return res;
  } catch (e) { return fail(e); }
}

export function formObj(form: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") o[k] = v.trim();
  return o;
}
export { ConflictError, PlanLimitError, UserError, AccessDenied };
export type { Ctx };
