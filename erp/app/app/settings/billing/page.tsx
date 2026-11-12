import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert, Kpi } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { currentPlans, subscriptionOf, usage } from "@/lib/billing";
import { choosePlanAction, cancelSubAction, resumeSubAction } from "../actions";
import { formatMoney } from "@/lib/money";
export default async function Billing() {
  const ctx = await requireTenant("billing.manage");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ sub: await subscriptionOf(db, ctx.tenant.id), plans: await currentPlans(db), use: await usage(db, ctx.tenant.id),
    invoices: (await db.query("select * from platform_invoices where tenant_id=$1 order by created_at desc limit 24", [ctx.tenant.id])).rows,
    pays: (await db.query("select p.*, i.number from platform_payments p join platform_invoices i on i.id=p.invoice_id where p.tenant_id=$1 order by p.created_at desc limit 24", [ctx.tenant.id])).rows,
    pending: (await db.query("select name from plan_versions pv join plans p on p.id=pv.plan_id where pv.id=(select pending_plan_version_id from subscriptions where tenant_id=$1 and status in ('trialing','active','past_due') limit 1)", [ctx.tenant.id])).rows[0] }));
  const s = d.sub;
  return (<><PageHead title="Plan & billing" crumbs={[["Company"], ["Billing"]]} sub="Your Ledgerline subscription. Your company’s own invoices and receipts are separate and live under Finance." />
    {s?.status === "past_due" && <Alert tone="bad">Your last payment failed. You have full access until {s.grace_until ? new Date(s.grace_until).toDateString() : "the grace period ends"}; pay the open invoice below to avoid read-only mode.</Alert>}
    {s?.cancel_at_period_end && <Alert tone="warn">Cancellation scheduled — access ends {new Date(s.current_period_end).toDateString()}. <StatusButton action={resumeSubAction} label="Keep my subscription" /></Alert>}
    {d.pending && <Alert tone="info">Scheduled change to <strong>{d.pending.name}</strong> at the end of the current period.</Alert>}
    {s && <div className="kpis"><Kpi label="Plan" value={`${s.plan_name} v${s.version}`} hint={`${s.status} · ${s.billing_interval}`} /><Kpi label="Users" value={`${d.use.users} / ${s.max_users}`} hint={`${d.use.pendingInvites} invited`} /><Kpi label="Branches" value={`${d.use.branches} / ${s.max_branches}`} /><Kpi label="Storage" value={`${d.use.storageMb} / ${s.max_storage_mb} MB`} /><Kpi label={s.status === "trialing" ? "Trial ends" : "Renews"} value={new Date(s.current_period_end).toLocaleDateString("en-IN")} /></div>}
    <div className="grid g3">{d.plans.map((p: any) => (<div className="card" key={p.id}><h2>{p.name}</h2><p className="muted small">{p.max_users} users · {p.max_branches} branches</p><p>{formatMoney(p.price_monthly_paise)}/mo or {formatMoney(p.price_yearly_paise)}/yr <span className="muted small">+ GST</span></p>
      <ActionForm action={choosePlanAction} submit={s?.plan_key === p.key && s.status === "active" ? "Change billing interval" : s?.status === "active" ? "Switch to this plan" : "Choose plan"} guard={false}><input type="hidden" name="plan" value={p.key} />
        <Field name="interval" label="Billing" type="select" defaultValue="monthly"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Field><Field name="coupon" label="Coupon (optional)" /></ActionForm></div>))}</div>
    <p className="small muted">Upgrades are charged pro rata now. Downgrades start next period and are refused if your users or branches would not fit — you’d be told exactly what to remove.</p>
    <div className="card"><h2>Invoices</h2><div className="tablewrap"><table className="stack-sm"><thead><tr><th>Number</th><th>Description</th><th>Status</th><th className="num">Total (incl. GST)</th><th></th></tr></thead><tbody>
      {d.invoices.map((i: any) => <tr key={i.id}><td data-label="Number">{i.number}</td><td data-label="Description">{i.description}</td><td data-label="Status"><Badge status={i.status} /></td><td data-label="Total" className="num">{formatMoney(i.total_paise)}</td><td>{["open", "failed"].includes(i.status) && <Link className="btn sm primary" href={`/app/settings/billing/checkout/${i.id}`}>Pay now</Link>}</td></tr>)}</tbody></table></div></div>
    <div className="card"><h2>Payment history</h2>{d.pays.length === 0 ? <p className="muted">No payments yet.</p> : d.pays.map((p: any) => <p key={p.id}>{new Date(p.created_at).toLocaleDateString("en-IN")} · {p.number} · {formatMoney(p.amount_paise)} · <Badge status={p.status} />{p.failure_reason && <span className="muted small"> {p.failure_reason}</span>}</p>)}
      <p className="small muted">Card details are handled by the payment provider; Ledgerline never stores card numbers.</p></div>
    {s && !s.cancel_at_period_end && <details className="drawer"><summary>Cancel subscription</summary><div><p>You keep access to the end of the paid period and can export all data afterwards.</p><ActionForm action={cancelSubAction} submit="Schedule cancellation" danger confirm="Schedule cancellation at the end of the period?"><Field name="reason" label="Why are you leaving?" required /></ActionForm></div></details>}</>);
}
