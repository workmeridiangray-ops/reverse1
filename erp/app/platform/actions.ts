"use server";
import { randomBytes } from "node:crypto";
import { withSystem } from "@/lib/db";
import { fail, formObj, type ActionResult } from "@/lib/actions";
import { requirePlatform } from "@/lib/auth/session";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { setTenantStatus, refundPayment, label } from "@/lib/platform";
import { retryJob } from "@/lib/jobs";
import { parseMoney } from "@/lib/money";

async function run(roles: string[], form: FormData | null, fn: (c: Awaited<ReturnType<typeof requirePlatform>>, db: any, f: Record<string, string>) => Promise<ActionResult | void>): Promise<ActionResult> {
  try { const c = await requirePlatform(...roles); return await withSystem(async (db) => (await fn(c, db, form ? formObj(form) : {})) ?? { ok: true }); } catch (e) { return fail(e); }
}
export async function suspendAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["support"], f, async (c, db, o) => { await setTenantStatus(db, c, id, "suspended", o.reason ?? ""); return { ok: true, message: "Company suspended; all sessions ended." }; }); }
export async function unsuspendAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["support"], f, async (c, db, o) => { await setTenantStatus(db, c, id, "active", o.reason ?? ""); return { ok: true, message: "Company restored." }; }); }
export async function refundAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["billing"], f, async (c, db, o) => { await refundPayment(db, c, id, o.reason ?? ""); return { ok: true, message: "Refund recorded." }; }); }
export async function extendTrialAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["billing", "support"], f, async (c, db, o) => {
  const days = Number(o.days); if (!(days >= 1 && days <= 60)) throw new UserError("Extend by 1–60 days.", { days: "Invalid" }); if ((o.reason ?? "").length < 5) throw new UserError("A reason is required.", { reason: "Required" });
  await db.query("update tenants set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + ($2 || ' days')::interval where id=$1", [id, String(days)]);
  await db.query("update subscriptions set status='trialing', current_period_end = (select trial_ends_at from tenants where id=$1) where tenant_id=$1 and status in ('trialing','expired')", [id]);
  await audit(db, { tenantId: id, actorUserId: c.user.id, actorLabel: label(c), action: "platform.trial_extended", reason: o.reason, detail: { days } }); return { ok: true, message: `Trial extended by ${days} days.` };
}); }
export async function creditAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["billing"], f, async (c, db, o) => {
  let a: number; try { a = parseMoney(o.amount); } catch (e: any) { throw new UserError(e.message, { amount: e.message }); } if ((o.reason ?? "").length < 5) throw new UserError("A reason is required.", { reason: "Required" });
  await db.query("insert into platform_credits(tenant_id,amount_paise,reason,created_by) values ($1,$2,$3,$4)", [id, a, o.reason, c.user.id]);
  await audit(db, { tenantId: id, actorUserId: c.user.id, actorLabel: label(c), action: "platform.credit_granted", reason: o.reason, detail: { amount: a } }); return { ok: true, message: "Credit added; applied to the next invoice." };
}); }
export async function supportRequestAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["support"], f, async (c, db, o) => {
  if ((o.reason ?? "").length < 10) throw new UserError("Explain why access is needed (ticket reference, issue).", { reason: "Required" });
  await db.query("insert into support_access(tenant_id,staff_user_id,reason) values ($1,$2,$3)", [id, c.user.id, o.reason]);
  await audit(db, { tenantId: id, actorUserId: c.user.id, actorLabel: label(c), action: "platform.support_access_requested", reason: o.reason }); return { ok: true, message: "Request sent. The company owner must approve it." };
}); }
export async function retryJobAction(id: string): Promise<ActionResult> { return run(["tech"], null, async (c, db) => { if (!(await retryJob(db, id))) throw new UserError("Only failed or dead jobs can be retried."); await audit(db, { actorUserId: c.user.id, actorLabel: label(c), action: "platform.job_retried", entityId: id }); return { ok: true, message: "Re-queued." }; }); }
export async function newPlanVersionAction(planId: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["billing"], f, async (c, db, o) => {
  let m: number, y: number; try { m = parseMoney(o.monthly); y = parseMoney(o.yearly); } catch (e: any) { throw new UserError(e.message); }
  const v = (await db.query("select coalesce(max(version),0)+1 v from plan_versions where plan_id=$1", [planId])).rows[0].v;
  await db.query("update plan_versions set retired_at=now() where plan_id=$1 and retired_at is null", [planId]);   // existing subscribers keep their version; new sales use the new one
  await db.query("insert into plan_versions(plan_id,version,price_monthly_paise,price_yearly_paise,max_users,max_branches,max_storage_mb,features) select $1,$2,$3,$4,$5,$6,$7,features from plan_versions where plan_id=$1 order by version desc limit 1", [planId, v, m, y, Number(o.users), Number(o.branches), Number(o.storage)]);
  await audit(db, { actorUserId: c.user.id, actorLabel: label(c), action: "platform.plan_version_created", entityId: planId, detail: { version: v, m, y } }); return { ok: true, message: `Version ${v} is live for new sales. Existing subscriptions keep their version until they change plan.` };
}); }
export async function setStaffAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["owner"], f, async (c, db, o) => {
  const u = (await db.query("select id from users where lower(email)=$1", [(o.email ?? "").toLowerCase()])).rows[0]; if (!u) throw new UserError("No user with that email. They must sign up first.", { email: "Unknown user" });
  if (u.id === c.user.id && o.role !== "owner") throw new UserError("You can’t demote yourself.");
  await db.query("update users set platform_role=nullif($2,'') where id=$1", [u.id, o.role ?? ""]);
  await audit(db, { actorUserId: c.user.id, actorLabel: label(c), action: "platform.staff_changed", entityId: u.id, detail: { role: o.role || "removed" } }); return { ok: true, message: "Staff access updated." };
}); }
export async function announceAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["owner", "support"], f, async (c, db, o) => {
  if (!o.title || !o.body) throw new UserError("Title and message are required."); await db.query("insert into announcements(title,body) values ($1,$2)", [o.title, o.body]);
  await audit(db, { actorUserId: c.user.id, actorLabel: label(c), action: "platform.announcement_published" }); return { ok: true, message: "Published on the Updates page." };
}); }
export async function couponAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["billing"], f, async (c, db, o) => {
  const pct = Number(o.percent); if (!(pct >= 1 && pct <= 100)) throw new UserError("Percent must be 1–100.", { percent: "Invalid" });
  const code = (o.code || randomBytes(3).toString("hex")).toUpperCase(); await db.query("insert into platform_coupons(code,percent_off,max_redemptions) values ($1,$2,$3)", [code, pct, o.max ? Number(o.max) : null]);
  await audit(db, { actorUserId: c.user.id, actorLabel: label(c), action: "platform.coupon_created", detail: { code, pct } }); return { ok: true, message: `Coupon ${code} created.` };
}); }
export async function requestStatusAction(id: string, status: string): Promise<ActionResult> { return run(["support"], null, async (_c, db) => { await db.query("update contact_requests set status=$2 where id=$1", [id, status]); }); }
export async function closeTenantAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> { return run(["owner"], f, async (c, db, o) => {
  if (o.confirm !== "CLOSE") throw new UserError("Type CLOSE to confirm.", { confirm: "Required" });
  await db.query("update tenants set status='closed', closed_at=now() where id=$1", [id]); await db.query("update subscriptions set status='cancelled', cancelled_at=now() where tenant_id=$1 and status in ('trialing','active','past_due')", [id]);
  await db.query("update closure_requests set status='completed' where tenant_id=$1 and status='requested'", [id]);
  const us = (await db.query("select user_id from memberships where tenant_id=$1", [id])).rows; const { revokeUserSessions } = await import("@/lib/auth/session"); for (const u of us) await revokeUserSessions(db, u.user_id, id);
  await audit(db, { tenantId: id, actorUserId: c.user.id, actorLabel: label(c), action: "platform.tenant_closed", reason: "closure confirmed" }); return { ok: true, message: "Company closed. Data deletion follows the retention schedule." };
}); }
