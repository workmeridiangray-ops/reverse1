import "server-only";
import { z } from "zod";
import { type Ctx, requireCtx } from "./auth";
import { type Db, NotFound, UserError } from "./db";
import type { Permission } from "@/lib/rules/permissions";
import { QtyError } from "@/lib/rules/qty";
import { BillingError } from "@/lib/rules/billing";
import { MoneyError } from "@/lib/rules/money";

export type FormState = { ok?: boolean; message?: string; error?: string; details?: string[]; fieldErrors?: Record<string, string>; redirectTo?: string } | null;

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const uuid = z.string().uuid("Invalid identifier");
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

/** Translate any thrown error to something a user can act on, without leaking internals. */
export function toState(e: unknown): FormState {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of e.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
    return { error: "Please correct the highlighted fields.", fieldErrors };
  }
  if (e instanceof UserError) return { error: e.message, details: e.details, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
  if (e instanceof QtyError || e instanceof BillingError || e instanceof MoneyError) return { error: e.message };
  if (e instanceof NotFound) return { error: "That record no longer exists or you do not have access to it." };
  const code = (e as { code?: string })?.code;
  if (code === "23505") return { error: "That already exists (duplicate). Nothing was changed." };
  if (code === "23503") return { error: "A related record is missing or belongs elsewhere. Refresh and try again." };
  if (code === "23514") return { error: "A value breaks a business rule (check amounts, reasons and quantities)." };
  if (code === "57014") return { error: "The request took too long. Try again." };
  console.error("action failed", e);
  return { error: "Something went wrong and nothing was saved. Please try again." };
}

/** Marks a request id as processed; returns false when it was already seen (duplicate submit). */
export async function firstTime(db: Db, scope: string, requestId: string | null): Promise<boolean> {
  if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) return true;
  const n = await db.exec("INSERT INTO request_log(request_id,scope) VALUES ($1,$2) ON CONFLICT DO NOTHING", [requestId, scope]);
  return n === 1;
}

/**
 * Wrap a tenant-scoped mutation: authenticates, checks the permission on the server, de-duplicates
 * double submits, runs the handler in an RLS-scoped transaction and returns a typed form state.
 * The handler returns a success message, or `{ message, redirectTo }`.
 */
export function mutation(perm: Permission | null, name: string, handler: (c: Ctx, db: Db, fd: FormData) => Promise<string | { message: string; redirectTo?: string }>) {
  return async (_prev: FormState, fd: FormData): Promise<FormState> => {
    try {
      const c = await requireCtx(perm ?? undefined);
      const out = await c.run(async (db) => {
        if (!(await firstTime(db, `${c.tenant.id}:${name}`, str(fd, "request_id")))) return { message: "Already saved — this submission was a duplicate and was ignored." };
        return handler(c, db, fd);
      });
      const o = typeof out === "string" ? { message: out } : out;
      return { ok: true, message: o.message, redirectTo: o.redirectTo };
    } catch (e) {
      return toState(e);
    }
  };
}
