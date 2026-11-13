import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany, type CompanyAuth, clientIp } from "./auth";
import { friendly, tx, type Db } from "./db";
import type { Perm } from "./perms";
import type { Ctx } from "./svc/ctx";

export type FormState = { ok?: string; error?: string } | null;
export type ActionArgs = { fd: FormData; ctx: Ctx; c: Db; auth: CompanyAuth };
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const num = (fd: FormData, k: string) => { const s = str(fd, k).replace(/,/g, ""); if (s === "") return NaN; return Number(s); };
export const reqNum = (fd: FormData, k: string, label: string) => { const n = num(fd, k); if (!Number.isFinite(n)) throw new (class extends Error {})(`${label} must be a number.`); return n; };

/** Wraps a tenant mutation: server-side auth + permission, tenant-bound transaction, friendly errors, cache refresh. */
export function action(perm: Perm | null, fn: (a: ActionArgs) => Promise<string | { redirect: string } | void>, opts?: { allowSuspended?: boolean }) {
  return async (_prev: FormState, fd: FormData): Promise<FormState> => {
    const auth = await requireCompany(perm ?? undefined, opts);
    const ctx: Ctx = { companyId: auth.company.id, userId: auth.user.id, role: auth.membership.role, plantIds: auth.membership.plantIds, label: auth.user.email, ip: await clientIp() };
    let out: string | { redirect: string } | void;
    try { out = await tx((c) => fn({ fd, ctx, c, auth }), { companyId: ctx.companyId, userId: ctx.userId, plantIds: ctx.plantIds }); }
    catch (e) { return { error: friendly(e) }; }
    revalidatePath("/app", "layout");
    if (out && typeof out === "object") redirect(out.redirect);
    return { ok: out || "Saved." };
  };
}

/** For public/pre-workspace forms (no tenant context). */
export function pubAction(fn: (fd: FormData) => Promise<string | { redirect: string } | void>) {
  return async (_prev: FormState, fd: FormData): Promise<FormState> => {
    let out: string | { redirect: string } | void;
    try { out = await fn(fd); } catch (e) { return { error: friendly(e) }; }
    if (out && typeof out === "object") redirect(out.redirect);
    return { ok: out || "Done." };
  };
}
