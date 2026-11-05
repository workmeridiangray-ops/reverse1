import { type Q, AppError, many, one } from './common';
import { audit, notify } from '../audit';
import { queueMail } from '../mail';
import { checkEntitlement, downgradeImpact, priceInvoice, prorate, type Limits } from '../rules/plan';
import { randomToken } from '../crypto';

export async function currentPlans(q: Q) {
  return many<any>(q, `select distinct on (code) * from plans where retired_at is null and effective_from <= current_date order by code, version desc`);
}
export async function usage(q: Q, orgId: string) { return (await one<any>(q, 'select org_usage($1) u', [orgId]))!.u as Limits & { externals: number }; }

async function settingNum(q: Q, key: string, d: number) { const r = await one<any>(q, 'select value from platform_settings where key = $1', [key]); return r ? Number(r.value) : d; }

export interface Quote { planId: string; planCode: string; planVersion: number; interval: 'month' | 'year'; subtotal: bigint; discount: bigint; tax: bigint; total: bigint; prorationCredit: bigint; couponCode: string | null; periodStart: Date; periodEnd: Date; isChange: boolean }

export async function quote(q: Q, orgId: string, planCode: string, interval: 'month' | 'year', couponCode?: string | null, now = new Date()): Promise<Quote> {
  const plan = await one<any>(q, `select * from plans where code = $1 and retired_at is null order by version desc limit 1`, [planCode]);
  if (!plan) throw new AppError('That plan is not available.', 'plan');
  const sub = await one<any>(q, 'select s.*, p.price_month_paise pm, p.price_year_paise py from subscriptions s join plans p on p.id = s.plan_id where org_id = $1', [orgId]);
  const price = BigInt(interval === 'month' ? plan.price_month_paise : plan.price_year_paise);
  let coupon = 0, code: string | null = null;
  if (couponCode?.trim()) {
    const c = await one<any>(q, `select * from coupons where code = $1 and active and (expires_at is null or expires_at > now()) and (max_redemptions is null or redeemed < max_redemptions)`, [couponCode.trim().toUpperCase()]);
    if (!c) throw new AppError('That coupon code is not valid or has expired.', 'coupon');
    coupon = c.percent_off; code = c.code;
  }
  const periodStart = now;
  const periodEnd = new Date(now); interval === 'month' ? periodEnd.setMonth(periodEnd.getMonth() + 1) : periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  let credit = 0n; let isChange = false;
  if (sub?.status === 'active' && sub.current_period_end && new Date(sub.current_period_end) > now) {
    // Mid-period upgrade: charge the new plan from now, credit the unused part of the old plan; new period starts now.
    isChange = true;
    const oldPrice = BigInt(sub.interval === 'month' ? sub.pm : sub.py);
    const p = prorate({ oldPaise: oldPrice, newPaise: oldPrice, periodStart: new Date(sub.current_period_start), periodEnd: new Date(sub.current_period_end), now });
    credit = p.creditPaise;
  }
  const net = price > credit ? price - credit : 0n;
  const gst = await settingNum(q, 'gst_percent', 18);
  const priced = priceInvoice(net, coupon, gst);
  return { planId: plan.id, planCode: plan.code, planVersion: plan.version, interval, subtotal: priced.subtotal, discount: priced.discount, tax: priced.tax, total: priced.total, prorationCredit: credit, couponCode: code, periodStart, periodEnd, isChange };
}

/** Checkout: creates the invoice and a pending payment. The subscription changes ONLY when a verified provider event arrives. */
export async function startCheckout(q: Q, orgId: string, userId: string, planCode: string, interval: 'month' | 'year', couponCode: string | null, createOrder: (amount: bigint, receipt: string) => Promise<{ id: string; provider: string }>) {
  const lim = await downgradeCheck(q, orgId, planCode);
  if (lim.length) throw new AppError(`Before switching you must reduce: ${lim.map(l => `${l.resource.replace('_', ' ')} (using ${l.used}, plan allows ${l.allowed})`).join(', ')}.`, 'downgrade_blocked');
  const qt = await quote(q, orgId, planCode, interval, couponCode);
  const number = `BL-${new Date().getFullYear()}-${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
  const inv = (await one<any>(q, `insert into platform_invoices(org_id, number, plan_code, plan_version, interval, period_start, period_end, subtotal_paise, discount_paise, tax_paise, total_paise, coupon_code, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'issued') returning *`,
    [orgId, number, qt.planCode, qt.planVersion, interval, qt.periodStart, qt.periodEnd, qt.subtotal.toString(), qt.discount.toString(), qt.tax.toString(), qt.total.toString(), qt.couponCode]))!;
  if (qt.total === 0n) { await settleInvoice(q, inv.id, 'zero_total'); return { invoice: inv, order: null, quote: qt, autoPaid: true }; }
  const order = await createOrder(qt.total, inv.number);
  await q.query(`insert into platform_payments(org_id, invoice_id, provider, provider_ref, amount_paise, status) values ($1,$2,$3,$4,$5,'pending')`, [orgId, inv.id, order.provider, order.id, qt.total.toString()]);
  await audit(q, { orgId, actorId: userId, action: 'billing.checkout', entity: 'platform_invoices', entityId: inv.id, detail: { plan: planCode, interval, total: qt.total.toString() } });
  return { invoice: inv, order, quote: qt, autoPaid: false };
}

async function downgradeCheck(q: Q, orgId: string, planCode: string) {
  const plan = await one<any>(q, `select * from plans where code = $1 and retired_at is null order by version desc limit 1`, [planCode]);
  return downgradeImpact(plan.limits, await usage(q, orgId));
}

async function settleInvoice(q: Q, invoiceId: string, ref: string) {
  const inv = await one<any>(q, 'select * from platform_invoices where id = $1 for update', [invoiceId]);
  if (!inv || inv.status === 'paid') return;
  const plan = (await one<any>(q, 'select id from plans where code = $1 and version = $2', [inv.plan_code, inv.plan_version]))!;
  await q.query(`update platform_invoices set status = 'paid', paid_at = now(), reconciliation_ref = $2 where id = $1`, [invoiceId, ref]);
  await q.query(`update subscriptions set plan_id = $2, interval = $3, status = 'active', current_period_start = $4, current_period_end = $5, grace_until = null, cancel_at_period_end = false, pending_plan_id = null, pending_interval = null, updated_at = now() where org_id = $1`,
    [inv.org_id, plan.id, inv.interval, inv.period_start, inv.period_end]);
  await q.query(`update orgs set status = 'active' where id = $1 and status in ('trial','past_due')`, [inv.org_id]);
  if (inv.coupon_code) await q.query('update coupons set redeemed = redeemed + 1 where code = $1', [inv.coupon_code]);
}

/**
 * Payment-provider events. Idempotent (provider event id is unique); safe to retry; every outcome is recorded.
 */
export async function handlePaymentEvent(q: Q, p: { provider: string; eventId: string; type: string; payload: any }): Promise<'processed' | 'duplicate'> {
  const ins = await q.query(`insert into webhook_events(provider, event_id, type, payload) values ($1,$2,$3,$4) on conflict (provider, event_id) do nothing`, [p.provider, p.eventId, p.type, JSON.stringify(p.payload)]);
  if (ins.rowCount === 0) {
    const ex = await one<any>(q, 'select status from webhook_events where provider = $1 and event_id = $2', [p.provider, p.eventId]);
    if (ex!.status === 'processed') return 'duplicate';
  }
  await q.query(`update webhook_events set attempts = attempts + 1 where provider = $1 and event_id = $2`, [p.provider, p.eventId]);
  try {
    const ref = p.payload?.order_id ?? p.payload?.payment?.entity?.order_id ?? p.payload?.ref;
    const pay = ref ? await one<any>(q, 'select * from platform_payments where provider = $1 and provider_ref = $2 for update', [p.provider, ref]) : null;
    if (!pay) throw new AppError(`No pending payment for reference ${ref}`, 'unknown_payment');
    if (p.type === 'payment.captured') {
      const amount = BigInt(p.payload?.amount ?? p.payload?.payment?.entity?.amount ?? pay.amount_paise);
      if (amount !== BigInt(pay.amount_paise)) throw new AppError('Captured amount does not match the invoice', 'amount_mismatch');
      await q.query(`update platform_payments set status = 'succeeded' where id = $1`, [pay.id]);
      await settleInvoice(q, pay.invoice_id, `${p.provider}:${p.eventId}`);
      const owners = await many<any>(q, `select user_id from memberships where org_id = $1 and role = 'owner' and status = 'active'`, [pay.org_id]);
      await notify(q, pay.org_id, owners.map(o => o.user_id), 'Payment received', 'Your subscription is active.', '/settings/billing');
    } else if (p.type === 'payment.failed') {
      await q.query(`update platform_payments set status = 'failed', failure_reason = $2 where id = $1`, [pay.id, String(p.payload?.error_description ?? 'declined').slice(0, 200)]);
      await q.query(`update platform_invoices set status = 'failed' where id = $1 and status = 'issued'`, [pay.invoice_id]);
      const grace = await settingNum(q, 'grace_days', 7);
      const sub = await one<any>(q, 'select * from subscriptions where org_id = $1', [pay.org_id]);
      if (sub?.status === 'active') {
        await q.query(`update subscriptions set status = 'past_due', grace_until = coalesce(grace_until, now() + ($2 || ' days')::interval) where org_id = $1`, [pay.org_id, String(grace)]);
        await q.query(`update orgs set status = 'past_due' where id = $1 and status = 'active'`, [pay.org_id]);
      }
      const owners = await many<any>(q, `select m.user_id, u.email from memberships m join users u on u.id = m.user_id where m.org_id = $1 and m.role = 'owner'`, [pay.org_id]);
      await notify(q, pay.org_id, owners.map(o => o.user_id), 'Payment failed', 'Update your payment method to avoid interruption.', '/settings/billing');
      for (const o of owners) await queueMail(q, o.email, 'Your Buildline payment failed', `We could not collect your subscription payment. Retry from Settings → Billing before the grace period ends.`, pay.org_id);
    } else if (p.type === 'refund.processed') {
      const amt = BigInt(p.payload?.refund_amount ?? pay.amount_paise);
      await q.query(`update platform_payments set refunded_paise = least(amount_paise, refunded_paise + $2), status = case when refunded_paise + $2 >= amount_paise then 'refunded' else status end where id = $1`, [pay.id, amt.toString()]);
    } else if (p.type === 'payment.dispute.created') {
      await q.query(`update platform_payments set status = 'disputed' where id = $1`, [pay.id]); await q.query(`update platform_invoices set status = 'disputed' where id = $1`, [pay.invoice_id]);
    } else throw new AppError(`Unhandled event type ${p.type}`, 'unhandled');
    await q.query(`update webhook_events set status = 'processed', processed_at = now(), last_error = null where provider = $1 and event_id = $2`, [p.provider, p.eventId]);
    return 'processed';
  } catch (e) {
    await q.query(`update webhook_events set status = 'failed', last_error = $3 where provider = $1 and event_id = $2`, [p.provider, p.eventId, (e as Error).message.slice(0, 300)]);
    throw e;
  }
}

export async function refundPayment(q: Q, actorId: string, paymentId: string, amount: bigint, reason: string) {
  const p = await one<any>(q, 'select * from platform_payments where id = $1 for update', [paymentId]);
  if (!p || p.status !== 'succeeded' && p.status !== 'refunded') throw new AppError('Only a successful payment can be refunded.', 'refund');
  if (reason.trim().length < 3) throw new AppError('A reason is required for a refund.', 'reason');
  if (amount <= 0n || BigInt(p.refunded_paise) + amount > BigInt(p.amount_paise)) throw new AppError('Refund must be positive and within the amount paid.', 'refund');
  const full = BigInt(p.refunded_paise) + amount === BigInt(p.amount_paise);
  await q.query(`update platform_payments set refunded_paise = refunded_paise + $2, status = case when $3 then 'refunded' else status end where id = $1`, [paymentId, amount.toString(), full]);
  if (full) await q.query(`update platform_invoices set status = 'refunded' where id = $1`, [p.invoice_id]);
  await audit(q, { orgId: p.org_id, actorId, role: 'platform', action: 'billing.refund', entity: 'platform_payments', entityId: paymentId, detail: { amount: amount.toString(), reason } });
}

export async function scheduleDowngrade(q: Q, orgId: string, planCode: string, interval: 'month' | 'year') {
  const impact = await downgradeCheck(q, orgId, planCode);
  if (impact.length) throw new AppError(`To downgrade, first reduce: ${impact.map(l => `${l.resource.replace('_', ' ')} by ${l.excess}`).join(', ')}.`, 'downgrade_blocked');
  const plan = await one<any>(q, `select id from plans where code = $1 and retired_at is null order by version desc limit 1`, [planCode]);
  await q.query('update subscriptions set pending_plan_id = $2, pending_interval = $3 where org_id = $1', [orgId, plan.id, interval]);
}
export async function cancelSubscription(q: Q, orgId: string, userId: string, undo = false) {
  await q.query('update subscriptions set cancel_at_period_end = $2 where org_id = $1', [orgId, !undo]);
  await audit(q, { orgId, actorId: userId, action: undo ? 'billing.cancel_undo' : 'billing.cancel', entity: 'subscriptions' });
}

/** Daily job: trial expiry, renewal due notices, grace expiry, scheduled plan changes and cancellations. Idempotent. */
export async function runSubscriptionSweep(q: Q, now = new Date()) {
  const out = { trialExpired: 0, renewalInvoices: 0, graceExpired: 0, cancelled: 0 };
  const subs = await many<any>(q, 'select s.*, o.name org_name from subscriptions s join orgs o on o.id = s.org_id');
  for (const s of subs) {
    const owners = await many<any>(q, `select m.user_id, u.email from memberships m join users u on u.id = m.user_id where m.org_id = $1 and m.role = 'owner'`, [s.org_id]);
    if (s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at) < now) {
      await q.query(`update subscriptions set status = 'expired' where org_id = $1`, [s.org_id]); out.trialExpired++;
      await notify(q, s.org_id, owners.map((o: any) => o.user_id), 'Your trial has ended', 'Choose a plan to keep editing. Your data is safe and readable.', '/settings/billing');
    } else if (s.status === 'active' && s.current_period_end && new Date(s.current_period_end) < now) {
      if (s.cancel_at_period_end) { await q.query(`update subscriptions set status = 'cancelled' where org_id = $1`, [s.org_id]); await q.query(`update orgs set status = 'cancelled' where id = $1`, [s.org_id]); out.cancelled++; }
      else {
        const grace = await settingNum(q, 'grace_days', 7);
        await q.query(`update subscriptions set status = 'past_due', grace_until = now() + ($2 || ' days')::interval where org_id = $1`, [s.org_id, String(grace)]);
        await q.query(`update orgs set status = 'past_due' where id = $1`, [s.org_id]);
        out.renewalInvoices++;
        for (const o of owners) await queueMail(q, o.email, 'Your Buildline renewal is due', `Your subscription period ended. Renew from Settings → Billing within ${grace} days to avoid read-only mode.`, s.org_id);
        await notify(q, s.org_id, owners.map((o: any) => o.user_id), 'Renewal due', `Renew within ${grace} days.`, '/settings/billing');
      }
    } else if (s.status === 'past_due' && s.grace_until && new Date(s.grace_until) < now) {
      await q.query(`update subscriptions set status = 'expired' where org_id = $1`, [s.org_id]); out.graceExpired++;
    }
  }
  return out;
}
