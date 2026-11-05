import "server-only";
import { plat, tx, UserError } from "./db";
import { auditPlat } from "./audit";
import { enqueue } from "./jobs";
import { sendEmail, APP_URL } from "./mail";
import { hmacHex, safeEqualHex } from "./crypto";
import { gstOn, roundPaise } from "@/lib/domain/money";

export const GRACE_DAYS = 7, TRIAL_DAYS = 14;
export type Cycle = "monthly" | "yearly";

export async function currentPlanVersions() {
  return (await plat(`select distinct on (p.id) p.id plan_id, p.code, p.name, v.id version_id, v.version, v.price_monthly_paise, v.price_yearly_paise, v.max_users, v.max_plants, v.max_items, v.features
    from plans p join plan_versions v on v.plan_id=p.id where p.active and v.effective_from <= current_date order by p.id, v.effective_from desc, v.version desc`)).rows
    .sort((a, b) => a.price_monthly_paise - b.price_monthly_paise);
}
export async function subscriptionOf(companyId: string) {
  return (await plat(`select s.*, v.max_users, v.max_plants, v.max_items, v.price_monthly_paise, v.price_yearly_paise, p.name plan_name, p.code plan_code, v.version plan_version
    from subscriptions s join plan_versions v on v.id=s.plan_version_id join plans p on p.id=v.plan_id where s.company_id=$1 order by s.created_at desc limit 1`, [companyId])).rows[0];
}
/** Limits that apply right now: paid plan, or the starter plan during trial. */
export async function limitsOf(companyId: string) {
  const s = await subscriptionOf(companyId);
  if (s && ["active", "trialing", "past_due"].includes(s.status)) return { users: s.max_users, plants: s.max_plants, items: s.max_items, plan: s.plan_name, status: s.status as string };
  const v = (await currentPlanVersions())[0];
  return { users: v.max_users, plants: v.max_plants, items: v.max_items, plan: v.name, status: "expired" };
}
export async function usageOf(companyId: string) {
  const r = await tx(async (c) => ({
    plants: (await c.query("select count(*)::int n from plants where active")).rows[0].n,
    items: (await c.query("select count(*)::int n from items where active")).rows[0].n,
  }), { companyId });
  const u = (await plat("select count(*)::int n from memberships where company_id=$1 and active and role not in ('customer','supplier')", [companyId])).rows[0].n;
  return { ...r, users: u as number };
}
export async function assertWithin(companyId: string, kind: "users" | "plants" | "items", adding = 1) {
  const co = (await plat("select status, trial_ends_at from companies where id=$1", [companyId])).rows[0];
  if (co.status === "trial" && co.trial_ends_at && new Date(co.trial_ends_at) < new Date()) throw new UserError("Your trial has ended. Choose a plan under Settings → Billing to continue.", "plan");
  const lim = await limitsOf(companyId), use = await usageOf(companyId);
  if (use[kind] + adding > lim[kind]) throw new UserError(`Your ${lim.plan} plan allows ${lim[kind]} ${kind}. Upgrade under Settings → Billing to add more.`, "plan-limit");
}
export function priceFor(v: { price_monthly_paise: number; price_yearly_paise: number }, cycle: Cycle) { return cycle === "yearly" ? Number(v.price_yearly_paise) : Number(v.price_monthly_paise); }
/** Proration for a mid-period upgrade: pay the price difference for the unused fraction of the current period. */
export function prorate(oldPaise: number, newPaise: number, periodStart: Date, periodEnd: Date, now: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime(); const left = Math.max(0, Math.min(total, periodEnd.getTime() - now.getTime()));
  return Math.max(0, roundPaise((newPaise - oldPaise) * (left / total)));
}
export async function couponPercent(code?: string | null) {
  if (!code) return 0;
  const r = (await plat("select percent_off from coupons where lower(code)=lower($1) and active", [code.trim()])).rows[0];
  if (!r) throw new UserError("That coupon code is not valid.");
  return r.percent_off as number;
}
/** What changing plan would cost / what must be reduced first. */
export async function planChangePreview(companyId: string, versionId: string, cycle: Cycle, coupon?: string) {
  const v = (await plat("select v.*, p.name from plan_versions v join plans p on p.id=v.plan_id where v.id=$1", [versionId])).rows[0];
  if (!v) throw new UserError("Plan not found.");
  const use = await usageOf(companyId); const sub = await subscriptionOf(companyId);
  const excess = (["users", "plants", "items"] as const).filter((k) => use[k] > v[`max_${k}`]).map((k) => ({ kind: k, using: use[k], allowed: v[`max_${k}`] as number }));
  let base = priceFor(v, cycle); let note = "";
  if (sub && sub.status === "active" && new Date(sub.period_end) > new Date() && sub.cycle === cycle) {
    const old = cycle === "yearly" ? Number(sub.price_yearly_paise) : Number(sub.price_monthly_paise);
    if (base > old) { base = prorate(old, base, new Date(sub.period_start), new Date(sub.period_end), new Date()); note = "Prorated for the remainder of your current period."; }
    else if (base < old) { note = "Downgrade takes effect at the end of your current period; no refund for the current one."; base = 0; }
  }
  const pct = await couponPercent(coupon);
  const net = base - roundPaise(base * pct / 100); const tax = gstOn(net);
  return { version: v, excess, net, tax, total: net + tax, note, blocked: excess.length > 0 && Number(v.price_monthly_paise) < Number(sub?.price_monthly_paise ?? Infinity) };
}
export async function startCheckout(companyId: string, versionId: string, cycle: Cycle, coupon: string | undefined, userId: string) {
  const pv = await planChangePreview(companyId, versionId, cycle, coupon);
  if (pv.blocked) throw new UserError(`Reduce usage before downgrading: ${pv.excess.map((e) => `${e.kind} ${e.using}/${e.allowed}`).join(", ")}.`, "downgrade");
  if (pv.total <= 0 && !pv.note.startsWith("Downgrade")) throw new UserError("Nothing to charge.");
  const num = "INV-" + new Date().getFullYear() + "-" + String((await plat("select count(*)+1 n from platform_invoices")).rows[0].n).padStart(5, "0") + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
  const inv = (await plat("insert into platform_invoices(company_id,number,plan_version_id,description,amount_paise,tax_paise,status,provider) values ($1,$2,$3,$4,$5,$6,'pending',$7) returning id",
    [companyId, num, versionId, `${pv.version.name} plan (${cycle})`, pv.net, pv.tax, provider()])).rows[0];
  await plat("update platform_invoices set reconciliation_ref=$2 where id=$1", [inv.id, JSON.stringify({ cycle })]);
  const order = await createProviderOrder(inv.id, pv.total, num);
  await plat("update platform_invoices set provider_ref=$2 where id=$1", [inv.id, order.id]);
  await auditPlat({ userId, companyId }, "billing.checkout_started", "platform_invoice", inv.id, { total: pv.total, cycle });
  return { invoiceId: inv.id as string, orderId: order.id as string, total: pv.total, keyId: order.keyId as string | undefined, provider: provider(), number: num };
}
export const provider = () => (process.env.RAZORPAY_KEY_ID ? "razorpay" : process.env.ALLOW_SANDBOX_PAYMENTS === "1" ? "sandbox" : "none");
async function createProviderOrder(invoiceId: string, totalPaise: number, receipt: string) {
  const p = provider();
  if (p === "razorpay") {
    const res = await fetch("https://api.razorpay.com/v1/orders", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64") },
      body: JSON.stringify({ amount: totalPaise, currency: "INR", receipt, notes: { invoiceId } }) });
    if (!res.ok) throw new UserError("The payment provider could not start the payment. Please try again.", "provider");
    const j = await res.json(); return { id: j.id as string, keyId: process.env.RAZORPAY_KEY_ID };
  }
  if (p === "sandbox") return { id: "sbx_order_" + invoiceId.slice(0, 8), keyId: undefined };
  throw new UserError("Online payments are not configured on this installation. Contact support.", "provider");
}
export function webhookSecret() { return process.env.RAZORPAY_WEBHOOK_SECRET ?? process.env.SANDBOX_WEBHOOK_SECRET ?? ""; }
/** Verify, record once (idempotent on event id), then process asynchronously with retries. */
export async function receiveWebhook(raw: string, signature: string | null) {
  const secret = webhookSecret();
  const ok = !!secret && !!signature && safeEqualHex(hmacHex(secret, raw), signature);
  let body: any = {}; try { body = JSON.parse(raw); } catch { return { status: 400 }; }
  if (!ok) { await plat("insert into webhook_events(provider,event_id,payload,signature_ok,status,error) values ($1,$2,$3,false,'ignored','bad signature') on conflict do nothing", [provider(), "bad-" + Date.now() + Math.random(), JSON.stringify({ truncated: raw.slice(0, 500) })]); return { status: 401 }; }
  const eventId = String(body.id ?? body.event_id ?? hmacHex("id", raw).slice(0, 24));
  const r = await plat("insert into webhook_events(provider,event_id,payload,signature_ok) values ($1,$2,$3,true) on conflict (provider,event_id) do nothing returning id", [provider(), eventId, raw]);
  if (r.rowCount) await enqueue("process_webhook", { id: r.rows[0].id }, `wh:${r.rows[0].id}`);
  return { status: 200, duplicate: !r.rowCount };
}
export async function processWebhookEvent(id: string) {
  const ev = (await plat("select * from webhook_events where id=$1", [id])).rows[0]; if (!ev || ev.status === "processed") return;
  try {
    const b = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload;
    const type: string = b.event ?? b.type;
    const orderId = b.payload?.payment?.entity?.order_id ?? b.order_id; const payId = b.payload?.payment?.entity?.id ?? b.payment_id;
    if (type === "payment.captured" || type === "payment.succeeded") await settleInvoiceByOrder(orderId, payId, true);
    else if (type === "payment.failed") await settleInvoiceByOrder(orderId, payId, false);
    else if (type === "refund.processed") await plat("update platform_invoices set status='refunded' where provider_ref=$1 and status='paid'", [orderId]);
    else if (type === "payment.dispute.created") await plat("update platform_invoices set status='disputed' where provider_ref=$1", [orderId]);
    await plat("update webhook_events set status='processed', attempts=attempts+1 where id=$1", [id]);
  } catch (e) { await plat("update webhook_events set status='failed', error=$2, attempts=attempts+1 where id=$1", [id, String(e)]); throw e; }
}
/** Idempotent: repeating a captured payment never extends a subscription twice. */
export async function settleInvoiceByOrder(orderId: string, paymentId: string | undefined, success: boolean) {
  const inv = (await plat("select * from platform_invoices where provider_ref=$1", [orderId])).rows[0];
  if (!inv) throw new Error("No invoice for order " + orderId);
  if (inv.status === "paid") return;
  if (!success) {
    await plat("update platform_invoices set status='failed' where id=$1 and status='pending'", [inv.id]);
    await plat("update subscriptions set status='past_due', grace_until=coalesce(grace_until, now()+interval '7 days') where company_id=$1 and status='active'", [inv.company_id]);
    await plat("update companies set status='past_due' where id=$1 and status='active'", [inv.company_id]);
    const co = (await plat("select billing_email, name from companies where id=$1", [inv.company_id])).rows[0];
    if (co?.billing_email) await sendEmail(co.billing_email, "Payment failed — action needed", `Payment for ${inv.number} failed. You have ${GRACE_DAYS} days to retry from Settings → Billing before access is limited.\n${APP_URL()}/app/settings/billing`, inv.company_id);
    return;
  }
  const cycle: Cycle = (() => { try { return JSON.parse(inv.reconciliation_ref ?? "{}").cycle ?? "monthly"; } catch { return "monthly"; } })();
  await tx(async (c) => {
    const up = await c.query("update platform_invoices set status='paid', paid_at=now(), reconciliation_ref=$2 where id=$1 and status in ('pending','failed') returning id", [inv.id, `${orderId}/${paymentId ?? ""}`]);
    if (!up.rowCount) return;
    const days = cycle === "yearly" ? 365 : 30;
    const cur = (await c.query("select * from subscriptions where company_id=$1 and status in ('active','past_due','trialing') order by created_at desc limit 1", [inv.company_id])).rows[0];
    const sameVersion = cur && cur.plan_version_id === inv.plan_version_id && cur.status !== "trialing";
    const start = sameVersion && new Date(cur.period_end) > new Date() ? new Date(cur.period_end) : new Date();
    if (cur) await c.query("update subscriptions set status='expired' where id=$1", [cur.id]);
    await c.query("insert into subscriptions(company_id,plan_version_id,cycle,status,period_start,period_end) values ($1,$2,$3,'active',$4,$5)", [inv.company_id, inv.plan_version_id, cycle, start, new Date(start.getTime() + days * 86400000)]);
    await c.query("update companies set status='active' where id=$1 and status in ('trial','past_due','suspended')", [inv.company_id]);
  });
  await auditPlat({ companyId: inv.company_id }, "billing.payment_captured", "platform_invoice", inv.id, { paymentId });
}
/** Browser-side confirmation (Razorpay Checkout handler). The signature proves the payment; the webhook remains the source of truth. */
export async function confirmClientPayment(orderId: string, paymentId: string, signature: string) {
  const secret = process.env.RAZORPAY_KEY_SECRET ?? process.env.SANDBOX_WEBHOOK_SECRET ?? "";
  if (!secret || !safeEqualHex(hmacHex(secret, `${orderId}|${paymentId}`), signature)) throw new UserError("Payment signature could not be verified.", "signature");
  await settleInvoiceByOrder(orderId, paymentId, true);
}
export async function scanRenewals() {
  const due = (await plat("select * from subscriptions where status='active' and period_end < now()")).rows;
  for (const s of due) {
    if (s.cancel_at_period_end) { await plat("update subscriptions set status='expired' where id=$1", [s.id]); await plat("update companies set status='cancelled' where id=$1", [s.company_id]); continue; }
    await plat("update subscriptions set status='past_due', grace_until=now()+interval '7 days' where id=$1", [s.id]);
    await plat("update companies set status='past_due' where id=$1", [s.company_id]);
    const co = (await plat("select billing_email from companies where id=$1", [s.company_id])).rows[0];
    if (co?.billing_email) await sendEmail(co.billing_email, "Renew your subscription", `Your subscription period ended. Renew within ${GRACE_DAYS} days from ${APP_URL()}/app/settings/billing to avoid interruption.`, s.company_id);
  }
  await plat("update subscriptions set status='expired' where status='past_due' and grace_until < now()");
  await plat("update companies set status='suspended' where status='past_due' and id in (select company_id from subscriptions where status='expired')");
  await plat("update companies set status='suspended' where status='trial' and trial_ends_at < now() - interval '7 days'");
  return due.length;
}
