import { requireCompany } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { currentPlanVersions, subscriptionOf, usageOf, limitsOf, provider } from "@/lib/server/billing";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, Note, date, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { checkoutAction, cancelSubscriptionAction } from "../../actions2";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Plan & billing" };
export const dynamic = "force-dynamic";
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("admin.billing", { allowSuspended: true }); const sp = await searchParams;
  const [plans, sub, use, lim] = [await currentPlanVersions(), await subscriptionOf(a.company.id), await usageOf(a.company.id), await limitsOf(a.company.id)];
  const invs = (await plat("select * from platform_invoices where company_id=$1 order by created_at desc limit 30", [a.company.id])).rows;
  const co = (await plat("select status, trial_ends_at from companies where id=$1", [a.company.id])).rows[0];
  return <Page title="Plan & billing" sub="Invoices keep the plan version and price that applied when they were issued.">
    {sp.paid === "1" && <Note tone="ok">Payment received. Your subscription is active.</Note>}{sp.paid === "0" && <Note tone="danger">Payment failed. You can retry below; access continues through the grace period.</Note>}
    {co.status === "past_due" && <Note tone="danger">Your subscription is past due. Pay within the 7-day grace period to avoid suspension.</Note>}{co.status === "suspended" && <Note tone="danger">Workspace suspended for non-payment. Pay a plan below to restore access immediately.</Note>}
    {provider() === "none" && <Note tone="warn">Online payments are not configured on this installation (set RAZORPAY_* variables). Contact support to pay by other means.</Note>}
    <div className="grid gap-4 lg:grid-cols-3"><Card title="Current plan"><p className="text-lg font-semibold">{lim.plan}</p><p className="text-sm text-muted">Status: <Badge s={sub?.status ?? "expired"} />{co.trial_ends_at && co.status === "trial" ? ` · trial ends ${date(co.trial_ends_at)}` : ""}</p>{sub && <p className="text-sm text-muted">Period {date(sub.period_start)} → {date(sub.period_end)} ({sub.cycle})</p>}
      <ul className="mt-3 space-y-1 text-sm">{(["users", "plants", "items"] as const).map((k) => <li key={k} className="flex justify-between capitalize"><span>{k}</span><span className="num">{use[k]} / {lim[k]}</span></li>)}</ul></Card>
      <Card title="Change plan" className="lg:col-span-2"><ActionForm action={checkoutAction} submit="Continue to payment"><Grid><Field label="Plan" name="version" required options={plans.map((p: any) => ({ value: p.version_id, label: `${p.name} — ${formatINR(p.price_monthly_paise)}/mo · ${p.max_users} users, ${p.max_plants} plants` }))} /><Field label="Billing" name="cycle" options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly (10 months)" }]} defaultValue="monthly" /><Field label="Coupon (optional)" name="coupon" /></Grid>
        <p className="mt-2 text-xs text-muted">Upgrades mid-period are prorated. Downgrades apply at period end and are blocked while usage exceeds the lower plan’s limits (you’ll be told what to reduce). GST at 18% is added at checkout.</p></ActionForm></Card></div>
    {sub?.status === "active" && <Card title="Cancellation" className="mt-4">{sub.cancel_at_period_end ? <ActionForm action={cancelSubscriptionAction} submit="Keep my subscription"><Hidden name="resume" value="1" /></ActionForm> : <ActionForm action={cancelSubscriptionAction} submit="Cancel at period end" danger confirm="Cancel at the end of the current period?"><Field label="Why are you leaving? (optional)" name="reason" /></ActionForm>}<p className="mt-2 text-xs text-muted">Export your data any time from Reports and Costing; exports stay available for 30 days after closure.</p></Card>}
    <h2 className="mb-2 mt-6 font-semibold">Invoices & payments</h2>
    <DataTable rows={invs} empty="No invoices yet." cols={[{ h: "Invoice", r: (r: any) => r.number }, { h: "Description", r: (r: any) => r.description, hideSm: true }, { h: "Amount", r: (r: any) => formatINR(r.amount_paise), num: true }, { h: "GST", r: (r: any) => formatINR(r.tax_paise), num: true, hideSm: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "Date", r: (r: any) => dt(r.created_at), hideSm: true },
      { h: "", r: (r: any) => ["pending", "failed"].includes(r.status) ? <a className="text-brand underline" href={`/app/settings/billing/pay/${r.id}`}>{r.status === "failed" ? "Retry" : "Pay"}</a> : null }]} /></Page>;
}
