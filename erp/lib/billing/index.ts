import "server-only";
import type { Db } from "../db";
import { withSystem } from "../db";
import { audit } from "../audit";
import { queueEmail } from "../email";
import { enqueue, registerJob } from "../jobs";
import { env } from "../env";
import { UserError, PlanLimitError } from "../errors";
import { mulDiv } from "../money";
import type { PaymentEvent } from "./provider";

const GRACE_DAYS = 7, TRIAL_DAYS = 14;
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };

export async function currentPlans(db: Db) {
  return (await db.query(
    `select pv.*, p.key, p.name from plan_versions pv join plans p on p.id=pv.plan_id
      where p.active and pv.retired_at is null and pv.effective_from <= now()
        and pv.version = (select max(version) from plan_versions x where x.plan_id=pv.plan_id and x.retired_at is null and x.effective_from <= now()) order by pv.price_monthly_paise`)).rows;
}

export async function startTrial(db: Db, tenantId: string, planKey = "growth") {
  const pv = (await currentPlans(db)).find((p) => p.key === planKey);
  if (!pv) throw new Error("Plan catalogue is empty");
  const ends = new Date(Date.now() + TRIAL_DAYS * 86400_000);
  await db.query("insert into subscriptions(tenant_id, plan_version_id, status, current_period_start, current_period_end) values ($1,$2,'trialing',now(),$3)", [tenantId, pv.id, ends]);
  await db.query("update tenants set trial_ends_at=$2, status='trial' where id=$1", [tenantId, ends]);
}

export async function subscriptionOf(db: Db, tenantId: string) {
  return (await db.query(
    `select s.*, pv.version, pv.price_monthly_paise, pv.price_yearly_paise, pv.max_users, pv.max_branches, pv.max_storage_mb, pv.features, p.key plan_key, p.name plan_name
       from subscriptions s join plan_versions pv on pv.id=s.plan_version_id join plans p on p.id=pv.plan_id
      where s.tenant_id=$1 order by (s.status in ('trialing','active','past_due')) desc, s.created_at desc limit 1`, [tenantId])).rows[0] ?? null;
}

export async function usage(db: Db, tenantId: string) {
  const users = Number((await db.query("select count(*) c from memberships where tenant_id=$1 and status='active' and customer_id is null", [tenantId])).rows[0].c);
  const pending = Number((await db.query("select count(*) c from invitations where tenant_id=$1 and status='pending' and expires_at>now() and customer_id is null", [tenantId])).rows[0].c);
  const branches = Number((await db.query("select count(*) c from branches where tenant_id=$1 and status='active'", [tenantId])).rows[0].c);
  const storage = Number((await db.query("select coalesce(sum(size_bytes),0) s from files where tenant_id=$1", [tenantId])).rows[0].s);
  return { users, pendingInvites: pending, branches, storageMb: Math.ceil(storage / 1048576) };
}

export async function assertEntitled(db: Db, tenantId: string, what: "users" | "branches", adding = 1) {
  const sub = await subscriptionOf(db, tenantId);
  if (!sub) throw new PlanLimitError("No active plan. Choose a plan under Settings → Billing.");
  const u = await usage(db, tenantId);
  if (what === "users" && u.users + u.pendingInvites + adding > sub.max_users)
    throw new PlanLimitError(`Your ${sub.plan_name} plan allows ${sub.max_users} users (${u.users} active + ${u.pendingInvites} pending invitations). Upgrade your plan or revoke an invitation.`);
  if (what === "branches" && u.branches + adding > sub.max_branches)
    throw new PlanLimitError(`Your ${sub.plan_name} plan allows ${sub.max_branches} branch(es). Upgrade your plan to add more.`);
}

function price(pv: any, interval: string) { return interval === "yearly" ? pv.price_yearly_paise : pv.price_monthly_paise; }

async function newInvoice(db: Db, a: { tenantId: string; subId?: string; pv: any; interval: string; amount: number; purpose: "new" | "renewal" | "upgrade"; description: string; start?: Date; end?: Date; couponId?: string | null }) {
  const credit = (await db.query("select coalesce(sum(amount_paise),0) s from platform_credits where tenant_id=$1 and used_invoice_id is null", [a.tenantId])).rows[0].s as number;
  const applied = Math.min(Number(credit), a.amount);
  const net = a.amount - applied;
  const tax = mulDiv(net, env.gstRateBps, 10000);
  const number = "LL-" + new Date().getUTCFullYear() + "-" + String((await db.query("select count(*)+1 c from platform_invoices")).rows[0].c).padStart(6, "0") + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
  const inv = (await db.query(
    `insert into platform_invoices(tenant_id,number,subscription_id,plan_version_id,description,amount_paise,tax_paise,total_paise,period_start,period_end,purpose,billing_interval,coupon_id,credit_applied_paise)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [a.tenantId, number, a.subId ?? null, a.pv.id, a.description, net, tax, net + tax, a.start ?? null, a.end ?? null, a.purpose, a.interval, a.couponId ?? null, applied])).rows[0];
  if (applied > 0) {
    // consume credit rows oldest first up to `applied`
    let left = applied;
    for (const c of (await db.query("select * from platform_credits where tenant_id=$1 and used_invoice_id is null order by created_at for update", [a.tenantId])).rows) {
      if (left <= 0) break;
      if (c.amount_paise <= left) { await db.query("update platform_credits set used_invoice_id=$2 where id=$1", [c.id, inv.id]); left -= c.amount_paise; }
      else { await db.query("update platform_credits set amount_paise=amount_paise-$2 where id=$1", [c.id, left]); await db.query("insert into platform_credits(tenant_id,amount_paise,reason,used_invoice_id) values ($1,$2,$3,$4)", [a.tenantId, left, "Applied to " + number, inv.id]); left = 0; }
    }
  }
  return inv;
}

export async function applyCoupon(db: Db, code: string) {
  const c = (await db.query("select * from platform_coupons where lower(code)=lower($1) and active and (max_redemptions is null or redeemed < max_redemptions) for update", [code])).rows[0];
  if (!c) throw new UserError("That coupon code is not valid or has been used up.", { coupon: "Invalid coupon" });
  return c;
}

/** Invoice for selecting / switching plan. New or expired subscriptions pay in full; upgrades pay the prorated difference now. */
export async function planChangeInvoice(db: Db, tenantId: string, planKey: string, interval: "monthly" | "yearly", couponCode?: string) {
  const pv = (await currentPlans(db)).find((p) => p.key === planKey);
  if (!pv) throw new UserError("Unknown plan");
  const sub = await subscriptionOf(db, tenantId);
  const u = await usage(db, tenantId);
  if (u.users > pv.max_users || u.branches > pv.max_branches) {
    const parts = [];
    if (u.users > pv.max_users) parts.push(`${u.users - pv.max_users} user(s) over the ${pv.max_users}-user limit — suspend or remove users first`);
    if (u.branches > pv.max_branches) parts.push(`${u.branches - pv.max_branches} branch(es) over the ${pv.max_branches}-branch limit — retire branches first`);
    throw new PlanLimitError(`${pv.name} cannot hold your current setup: ${parts.join("; ")}.`);
  }
  let coupon: any = null;
  if (couponCode) coupon = await applyCoupon(db, couponCode);
  const full = price(pv, interval);
  const live = sub && sub.status === "active" ? sub : null;
  if (live && live.plan_version_id === pv.id && live.billing_interval === interval) throw new UserError("You are already on this plan.");
  let amount = full, purpose: "new" | "upgrade" = "new", description = `${pv.name} plan (${interval})`;
  let start: Date | undefined = new Date(), end: Date | undefined = interval === "yearly" ? addMonths(new Date(), 12) : addMonths(new Date(), 1);
  if (live) {
    const oldPrice = price(live, live.billing_interval);
    const remaining = Math.max(0, new Date(live.current_period_end).getTime() - Date.now());
    const total = new Date(live.current_period_end).getTime() - new Date(live.current_period_start).getTime();
    const sameInterval = live.billing_interval === interval;
    if (!sameInterval || full <= oldPrice) {
      // downgrade or interval change: takes effect at the next renewal, nothing to pay now
      await db.query("update subscriptions set pending_plan_version_id=$2, pending_interval=$3 where id=$1", [live.id, pv.id, interval]);
      await audit(db, { tenantId, action: "subscription.change_scheduled", entityType: "subscription", entityId: live.id, detail: { plan: planKey, interval, effective: live.current_period_end } });
      return { scheduled: true as const, effective: live.current_period_end as string };
    }
    amount = Math.round(((full - oldPrice) * remaining) / total);
    purpose = "upgrade"; description = `Upgrade to ${pv.name} (prorated for the rest of the period)`; start = new Date(live.current_period_start); end = new Date(live.current_period_end);
  }
  if (coupon) amount = Math.round((amount * (100 - coupon.percent_off)) / 100);
  const inv = await newInvoice(db, { tenantId, subId: sub?.id, pv, interval, amount, purpose, description, start, end, couponId: coupon?.id });
  if (coupon) await db.query("update platform_coupons set redeemed=redeemed+1 where id=$1", [coupon.id]);
  await audit(db, { tenantId, action: "billing.invoice_created", entityType: "platform_invoice", entityId: inv.id, detail: { number: inv.number, total: inv.total_paise } });
  return { scheduled: false as const, invoice: inv };
}

export async function cancelSubscription(db: Db, tenantId: string, userId: string, reason: string) {
  const sub = await subscriptionOf(db, tenantId);
  if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) throw new UserError("There is no active subscription to cancel.");
  await db.query("update subscriptions set cancel_at_period_end=true where id=$1", [sub.id]);
  await audit(db, { tenantId, actorUserId: userId, action: "subscription.cancel_requested", entityType: "subscription", entityId: sub.id, reason, detail: { accessUntil: sub.current_period_end } });
  return sub.current_period_end as string;
}
export async function resumeSubscription(db: Db, tenantId: string, userId: string) {
  await db.query("update subscriptions set cancel_at_period_end=false, pending_plan_version_id=null, pending_interval=null where tenant_id=$1 and status in ('active','trialing','past_due')", [tenantId]);
  await audit(db, { tenantId, actorUserId: userId, action: "subscription.resumed" });
}

// -------- applying provider events (idempotent) --------
export async function applyPaymentEvent(db: Db, provider: string, ev: PaymentEvent) {
  if (ev.type === "ignored") return "ignored";
  let inv: any = null;
  if (ev.invoiceId) inv = (await db.query("select * from platform_invoices where id=$1 for update", [ev.invoiceId])).rows[0];
  else if (ev.paymentId) inv = (await db.query("select i.* from platform_invoices i join platform_payments p on p.invoice_id=i.id where p.provider=$1 and p.provider_payment_id=$2 for update of i", [provider, ev.paymentId])).rows[0];
  if (!inv) throw new Error(`event ${ev.id}: no matching invoice`);
  if (ev.type !== "payment.failed" && ev.amount !== undefined && ev.type === "payment.succeeded" && ev.amount !== inv.total_paise) throw new Error(`event ${ev.id}: amount ${ev.amount} does not match invoice ${inv.number} (${inv.total_paise})`);
  const owners = async () => (await db.query(`select u.email from memberships m join roles r on r.id=m.role_id join users u on u.id=m.user_id where m.tenant_id=$1 and m.status='active' and 'billing.manage' = any(r.permissions)`, [inv.tenant_id])).rows as { email: string }[];
  switch (ev.type) {
    case "payment.succeeded": {
      const done = (await db.query("select 1 from platform_payments where provider=$1 and provider_payment_id=$2 and status='succeeded'", [provider, ev.paymentId])).rowCount;
      if (done || inv.status === "paid") return "duplicate";
      await db.query(`insert into platform_payments(tenant_id,invoice_id,provider,provider_payment_id,amount_paise,status,reconciliation_ref) values ($1,$2,$3,$4,$5,'succeeded',$6)
                      on conflict (provider, provider_payment_id) do update set status='succeeded'`, [inv.tenant_id, inv.id, provider, ev.paymentId, inv.total_paise, `${provider}:${ev.paymentId}:${inv.number}`]);
      await db.query("update platform_invoices set status='paid', paid_at=now() where id=$1", [inv.id]);
      await activateFromInvoice(db, inv);
      for (const o of await owners()) await queueEmail(db, { to: o.email, tenantId: inv.tenant_id, subject: `Payment received for ${inv.number}`, text: `We received your payment of ₹${(inv.total_paise / 100).toFixed(2)} for ${inv.description}. Thank you.`, dedupeKey: `paid:${inv.id}:${o.email}` });
      await audit(db, { tenantId: inv.tenant_id, actorLabel: provider, action: "billing.payment_succeeded", entityType: "platform_invoice", entityId: inv.id, detail: { paymentId: ev.paymentId } });
      return "applied";
    }
    case "payment.failed": {
      await db.query(`insert into platform_payments(tenant_id,invoice_id,provider,provider_payment_id,amount_paise,status,failure_reason) values ($1,$2,$3,$4,$5,'failed',$6) on conflict (provider, provider_payment_id) do nothing`,
        [inv.tenant_id, inv.id, provider, ev.paymentId ?? `fail-${ev.id}`, inv.total_paise, ev.reason ?? "Payment declined"]);
      if (inv.purpose === "renewal") {
        await db.query("update subscriptions set status='past_due', grace_until=coalesce(grace_until, now() + $2::interval) where tenant_id=$1 and status in ('active','past_due')", [inv.tenant_id, `${GRACE_DAYS} days`]);
        await db.query("update tenants set status='past_due' where id=$1 and status in ('active','trial')", [inv.tenant_id]);
      }
      for (const o of await owners()) await queueEmail(db, { to: o.email, tenantId: inv.tenant_id, subject: `Payment failed for ${inv.number}`, text: `Your payment could not be completed (${ev.reason ?? "declined"}). ${inv.purpose === "renewal" ? `Your account stays fully usable for ${GRACE_DAYS} days; please retry under Settings → Billing.` : "You can retry under Settings → Billing."}`, dedupeKey: `failed:${inv.id}:${ev.id}:${o.email}` });
      await audit(db, { tenantId: inv.tenant_id, actorLabel: provider, action: "billing.payment_failed", entityType: "platform_invoice", entityId: inv.id, detail: { reason: ev.reason } });
      return "applied";
    }
    case "payment.refunded":
      await db.query("update platform_payments set status='refunded' where provider=$1 and provider_payment_id=$2", [provider, ev.paymentId]);
      await db.query("update platform_invoices set status='refunded' where id=$1", [inv.id]);
      await audit(db, { tenantId: inv.tenant_id, actorLabel: provider, action: "billing.refunded", entityType: "platform_invoice", entityId: inv.id });
      return "applied";
    case "payment.disputed":
      await db.query("update platform_payments set status='disputed' where provider=$1 and provider_payment_id=$2", [provider, ev.paymentId]);
      await audit(db, { tenantId: inv.tenant_id, actorLabel: provider, action: "billing.disputed", entityType: "platform_invoice", entityId: inv.id });
      return "applied";
  }
}

async function activateFromInvoice(db: Db, inv: any) {
  const sub = (await db.query("select * from subscriptions where tenant_id=$1 and status in ('trialing','active','past_due') for update", [inv.tenant_id])).rows[0];
  if (inv.purpose === "upgrade" && sub) {
    await db.query("update subscriptions set plan_version_id=$2, billing_interval=$3, pending_plan_version_id=null, pending_interval=null where id=$1", [sub.id, inv.plan_version_id, inv.billing_interval]);
  } else if (inv.purpose === "renewal" && sub) {
    const base = new Date(sub.current_period_end) > new Date() ? new Date(sub.current_period_end) : new Date();
    const end = addMonths(base, inv.billing_interval === "yearly" ? 12 : 1);
    await db.query("update subscriptions set plan_version_id=$2, billing_interval=$3, status='active', current_period_start=$4, current_period_end=$5, grace_until=null, pending_plan_version_id=null, pending_interval=null where id=$1", [sub.id, inv.plan_version_id, inv.billing_interval, base, end]);
  } else {
    if (sub) await db.query("update subscriptions set status='cancelled', cancelled_at=now() where id=$1", [sub.id]);
    await db.query(`insert into subscriptions(tenant_id,plan_version_id,billing_interval,status,current_period_start,current_period_end) values ($1,$2,$3,'active',$4,$5)`,
      [inv.tenant_id, inv.plan_version_id, inv.billing_interval, inv.period_start ?? new Date(), inv.period_end ?? addMonths(new Date(), inv.billing_interval === "yearly" ? 12 : 1)]);
  }
  await db.query("update tenants set status='active' where id=$1 and status in ('trial','past_due','cancelled')", [inv.tenant_id]);
}

registerJob("payment_event", async (p) => {
  await withSystem(async (db) => {
    const ev = (await db.query("select * from webhook_events where id=$1 for update", [p.webhookId])).rows[0];
    if (!ev || ev.status === "processed") return;
    try {
      const { parseEvent } = await import("./provider");
      const parsed = parseEvent(ev.payload, ev.event_id);
      const r = await applyPaymentEvent(db, ev.provider, parsed);
      await db.query("update webhook_events set status=$2, processed_at=now(), error=null where id=$1", [ev.id, r === "ignored" ? "ignored" : "processed"]);
    } catch (e: any) {
      await db.query("update webhook_events set status='failed', error=$2 where id=$1", [ev.id, String(e.message).slice(0, 400)]);
      throw e;
    }
  });
});

// -------- periodic sweep: renewals, trial end, grace expiry, cancellations --------
export async function billingSweep() {
  return withSystem(async (db) => {
    const out = { renewalInvoices: 0, cancelled: 0, expiredGrace: 0, trialsEnded: 0 };
    const due = (await db.query(
      `select s.*, t.name tname from subscriptions s join tenants t on t.id=s.tenant_id where s.status in ('active','past_due') and s.cancel_at_period_end = false and s.current_period_end <= now() + interval '3 days'
         and not exists (select 1 from platform_invoices i where i.subscription_id=s.id and i.purpose='renewal' and i.status='open')`)).rows;
    for (const s of due) {
      const pvId = s.pending_plan_version_id ?? s.plan_version_id;
      const interval = s.pending_interval ?? s.billing_interval;
      const pv = (await db.query("select pv.*, p.name from plan_versions pv join plans p on p.id=pv.plan_id where pv.id=$1", [pvId])).rows[0];
      const inv = await newInvoice(db, { tenantId: s.tenant_id, subId: s.id, pv, interval, amount: price(pv, interval), purpose: "renewal", description: `${pv.name} renewal (${interval})` });
      const owners = (await db.query(`select u.email from memberships m join roles r on r.id=m.role_id join users u on u.id=m.user_id where m.tenant_id=$1 and m.status='active' and 'billing.manage' = any(r.permissions)`, [s.tenant_id])).rows;
      for (const o of owners) await queueEmail(db, { to: o.email, tenantId: s.tenant_id, subject: `Renewal invoice ${inv.number}`, text: `Your ${pv.name} subscription renews on ${new Date(s.current_period_end).toDateString()}. Pay ₹${(inv.total_paise / 100).toFixed(2)} under Settings → Billing → Invoices: ${env.appUrl}/app/settings/billing`, dedupeKey: `renew:${inv.id}:${o.email}` });
      out.renewalInvoices++;
    }
    // unpaid renewal past period end starts the grace period
    await db.query(`update subscriptions s set status='past_due', grace_until = coalesce(grace_until, s.current_period_end + $1::interval) where s.status='active' and s.current_period_end < now()`, [`${GRACE_DAYS} days`]);
    const canc = (await db.query("update subscriptions set status='cancelled', cancelled_at=now() where status in ('active','trialing','past_due') and cancel_at_period_end and current_period_end < now() returning tenant_id")).rows;
    for (const c of canc) { await db.query("update tenants set status='cancelled' where id=$1", [c.tenant_id]); out.cancelled++; }
    const exp = (await db.query("update subscriptions set status='expired' where status='past_due' and grace_until < now() returning tenant_id")).rows;
    for (const c of exp) { await db.query("update tenants set status='past_due' where id=$1", [c.tenant_id]); out.expiredGrace++; }
    const tr = (await db.query("update subscriptions set status='expired' where status='trialing' and current_period_end < now() returning tenant_id")).rowCount ?? 0;
    out.trialsEnded = tr;
    await db.query("update invitations set status='expired' where status='pending' and expires_at < now()");
    return out;
  });
}
registerJob("billing_sweep", async () => { await billingSweep(); });
export { enqueue };
