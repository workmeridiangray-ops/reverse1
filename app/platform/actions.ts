"use server";
import { z } from "zod";
import { audit, tx, UserError } from "@/lib/server/db";
import { type FormState, str, toState } from "@/lib/server/actions";
import { requirePlatform } from "@/lib/server/auth";

async function platformAction(fd: FormData, fn: (db: import("@/lib/server/db").Db, uid: string, fd: FormData) => Promise<string>): Promise<FormState> {
  try {
    const a = await requirePlatform();
    const msg = await tx({ userId: a.user.id, platform: true }, (db) => fn(db, a.user.id, fd));
    return { ok: true, message: msg };
  } catch (e) { return toState(e); }
}
const reasonOf = (fd: FormData) => z.string().trim().min(5, "A reason is required (at least 5 characters)").max(500).parse(str(fd, "reason"));

export async function setTenantStatus(_p: FormState, fd: FormData) {
  return platformAction(fd, async (db, uid, f) => {
    const id = z.string().uuid().parse(str(f, "tenant_id")); const to = z.enum(["suspended", "active", "closed"]).parse(str(f, "status")); const reason = reasonOf(f);
    const t = await db.one<{ status: string }>("SELECT status FROM tenants WHERE id=$1", [id]);
    if (t.status === "closed") throw new UserError("A closed business cannot be changed.");
    await db.exec("UPDATE tenants SET status=$2, suspended_reason=$3 WHERE id=$1", [id, to, to === "active" ? null : reason]);
    await audit(db, uid, id, `platform.tenant_${to}`, "tenant", id, { reason, from: t.status });
    return `Business set to ${to}.`;
  });
}
export async function activateTenant(_p: FormState, fd: FormData) {
  return platformAction(fd, async (db, uid, f) => {
    const id = z.string().uuid().parse(str(f, "tenant_id"));
    const ref = z.string().trim().min(3, "Enter the payment reference (e.g. bank UTR or invoice number)").max(120).parse(str(f, "payment_ref"));
    await db.exec("UPDATE tenants SET status='active', trial_ends_at=NULL, grace_until=NULL WHERE id=$1 AND status IN ('trial','past_due')", [id]);
    await audit(db, uid, id, "platform.tenant_activated", "tenant", id, { paymentRef: ref });
    return "Business activated against the recorded payment reference.";
  });
}
export async function extendTrial(_p: FormState, fd: FormData) {
  return platformAction(fd, async (db, uid, f) => {
    const id = z.string().uuid().parse(str(f, "tenant_id")); const days = z.coerce.number().int().min(1).max(90).parse(str(f, "days")); const reason = reasonOf(f);
    const n = await db.exec("UPDATE tenants SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + make_interval(days => $2), status='trial' WHERE id=$1 AND status IN ('trial')", [id, days]);
    if (!n) throw new UserError("Only a trial business can have its trial extended.");
    await audit(db, uid, id, "platform.trial_extended", "tenant", id, { days, reason });
    return `Trial extended by ${days} day(s).`;
  });
}
export async function retryEmail(_p: FormState, fd: FormData) {
  return platformAction(fd, async (db, uid, f) => {
    const n = await db.exec("UPDATE email_outbox SET status='pending', attempts=0, next_attempt_at=now(), last_error=NULL WHERE id=$1 AND status='failed'", [z.coerce.number().int().parse(str(f, "id"))]);
    if (!n) throw new UserError("That job is not in a failed state.");
    await audit(db, uid, null, "platform.email_retry", "email_outbox", str(f, "id"));
    return "Queued for another attempt.";
  });
}
