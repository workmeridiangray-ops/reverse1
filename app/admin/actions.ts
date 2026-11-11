"use server";
import { revalidatePath } from "next/cache";
import { pubAction, str } from "@/lib/server/action";
import { plat, UserError } from "@/lib/server/db";
import { requirePlatform, revokeUserSessions } from "@/lib/server/auth";
import { auditPlat } from "@/lib/server/audit";
import { retryJob } from "@/lib/server/jobs";
import { processWebhookEvent } from "@/lib/server/billing";
import { sendEmail } from "@/lib/server/mail";
import { parseRupees } from "@/lib/domain/money";

const need = (fd: FormData, k: string, l: string) => { const v = str(fd, k); if (!v) throw new UserError(`${l} is required.`); return v; };
const admin = (roles: string[], fn: (fd: FormData, uid: string) => Promise<string | void>) => pubAction(async (fd) => { const a = await requirePlatform(...roles); const r = await fn(fd, a.user.id); revalidatePath("/admin", "layout"); return r; });

export const setCompanyStatus = admin(["support", "billing"], async (fd, uid) => {
  const st = need(fd, "status", "Status"); if (!["active", "suspended", "trial", "closed"].includes(st)) throw new UserError("Invalid status.");
  const reason = need(fd, "reason", "Reason"); const id = need(fd, "id", "Company");
  await plat("update companies set status=$2 where id=$1", [id, st]);
  await auditPlat({ userId: uid, companyId: id }, "platform.company_status", "company", id, { status: st }, reason); return "Updated.";
});
export const extendTrial = admin(["support", "billing"], async (fd, uid) => {
  const days = Math.round(Number(need(fd, "days", "Days"))); if (!(days > 0 && days <= 60)) throw new UserError("Days must be 1–60.");
  const id = need(fd, "id", "Company"); await plat("update companies set trial_ends_at=greatest(trial_ends_at, now())+($2||' days')::interval, status=case when status in ('suspended','trial') then 'trial' else status end where id=$1", [id, String(days)]);
  await auditPlat({ userId: uid, companyId: id }, "platform.trial_extended", "company", id, { days }, str(fd, "reason") || undefined); return "Trial extended.";
});
export const newPlanVersion = admin(["billing"], async (fd, uid) => {
  const plan = need(fd, "plan", "Plan"); const v = (await plat("select coalesce(max(version),0)+1 v from plan_versions where plan_id=$1", [plan])).rows[0].v;
  const eff = need(fd, "effective", "Effective date"); if (eff < new Date().toISOString().slice(0, 10)) throw new UserError("Effective date cannot be in the past — historic invoices keep their own version.");
  let m: number, y: number; try { m = parseRupees(need(fd, "monthly", "Monthly price")); y = parseRupees(need(fd, "yearly", "Yearly price")); } catch (e: any) { throw new UserError(e.message); }
  await plat("insert into plan_versions(plan_id,version,effective_from,price_monthly_paise,price_yearly_paise,max_users,max_plants,max_items) values ($1,$2,$3,$4,$5,$6,$7,$8)", [plan, v, eff, m, y, Number(need(fd, "users", "Users")), Number(need(fd, "plants", "Plants")), Number(need(fd, "items", "Items"))]);
  await auditPlat({ userId: uid }, "platform.plan_version", "plan", plan, { v, eff }); return `Version ${v} scheduled for ${eff}. Existing invoices are unchanged.`;
});
export const refundInvoice = admin(["billing"], async (fd, uid) => {
  const id = need(fd, "id", "Invoice"); const reason = need(fd, "reason", "Reason"); const amt = parseRupees(need(fd, "amount", "Amount"));
  const inv = (await plat("select * from platform_invoices where id=$1", [id])).rows[0]; if (!inv || inv.status !== "paid") throw new UserError("Only paid invoices can be refunded.");
  const total = Number(inv.amount_paise) + Number(inv.tax_paise); if (amt <= 0 || amt + Number(inv.refunded_paise) > total) throw new UserError("Refund exceeds the amount paid.");
  await plat("update platform_invoices set refunded_paise=refunded_paise+$2, status=case when refunded_paise+$2>=$3 then 'refunded' else status end where id=$1", [id, amt, total]);
  await auditPlat({ userId: uid, companyId: inv.company_id }, "platform.refund", "platform_invoice", id, { amt, providerRef: inv.provider_ref }, reason);
  return "Refund recorded. Issue it at the payment provider using the reference shown — provider refunds are not automated in this release.";
});
export const replyTicket = admin(["support"], async (fd, uid) => {
  const t = (await plat("update support_tickets set reply=$2, status='resolved' where id=$1 returning user_id, subject", [need(fd, "id", "Ticket"), need(fd, "reply", "Reply")])).rows[0]; if (!t) throw new UserError("Ticket not found.");
  const u = (await plat("select email from users where id=$1", [t.user_id])).rows[0]; if (u) await sendEmail(u.email, `Re: ${t.subject}`, str(fd, "reply")); await auditPlat({ userId: uid }, "platform.ticket_reply", "support_ticket", str(fd, "id")); return "Reply sent.";
});
export const requestSupportAccess = admin(["support"], async (fd, uid) => {
  const id = need(fd, "company", "Company"); await plat("insert into support_access(company_id,requested_by,reason) values ($1,$2,$3)", [id, uid, need(fd, "reason", "Reason")]);
  await auditPlat({ userId: uid, companyId: id }, "platform.support_access_requested", "company", id); return "Request sent to the company owner for approval.";
});
export const retryJobAction = admin(["techops"], async (fd, uid) => { await retryJob(need(fd, "id", "Job")); await auditPlat({ userId: uid }, "platform.job_retry", "job", str(fd, "id")); return "Re-queued."; });
export const retryWebhook = admin(["techops", "billing"], async (fd, uid) => { await plat("update webhook_events set status='received' where id=$1 and status='failed'", [need(fd, "id", "Event")]); await processWebhookEvent(str(fd, "id")); await auditPlat({ userId: uid }, "platform.webhook_retry", "webhook", str(fd, "id")); return "Reprocessed."; });
export const postAnnouncement = admin(["owner"], async (fd, uid) => { await plat("insert into announcements(title,body) values ($1,$2)", [need(fd, "title", "Title"), need(fd, "body", "Body")]); await auditPlat({ userId: uid }, "platform.announcement"); return "Published on the updates page."; });
export const saveCoupon = admin(["billing"], async (fd, uid) => { const p = Math.round(Number(need(fd, "percent", "Percent"))); if (!(p >= 1 && p <= 100)) throw new UserError("Percent must be 1–100."); await plat("insert into coupons(code,percent_off) values ($1,$2) on conflict (code) do update set percent_off=excluded.percent_off, active=true", [need(fd, "code", "Code").toUpperCase(), p]); await auditPlat({ userId: uid }, "platform.coupon"); return "Saved."; });
export const toggleCoupon = admin(["billing"], async (fd) => { await plat("update coupons set active=not active where id=$1", [need(fd, "id", "Coupon")]); return "Toggled."; });
export const suspendUser = admin(["support", "owner"], async (fd, uid) => { const id = need(fd, "id", "User"); if (id === uid) throw new UserError("You cannot suspend yourself."); const on = str(fd, "on") === "1"; await plat("update users set suspended=$2 where id=$1", [id, on]); if (on) await revokeUserSessions(id); await auditPlat({ userId: uid }, on ? "platform.user_suspended" : "platform.user_restored", "user", id, {}, str(fd, "reason") || undefined); return on ? "User suspended and signed out." : "User restored."; });
export const setPlatformRole = admin(["owner"], async (fd, uid) => {
  const email = need(fd, "email", "Email").toLowerCase(); const role = str(fd, "role") || null; if (role && !["owner", "billing", "support", "techops"].includes(role)) throw new UserError("Invalid role.");
  const r = await plat("update users set platform_role=$2 where lower(email)=$1 returning id", [email, role]); if (!r.rowCount) throw new UserError("No user with that email — they must sign up first.");
  await auditPlat({ userId: uid }, "platform.staff_role", "user", r.rows[0].id, { role }); return "Updated.";
});
