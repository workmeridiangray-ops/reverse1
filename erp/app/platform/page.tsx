import Link from "next/link";
import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Kpi, Alert } from "@/components/ui";
import { formatMoney } from "@/lib/money";
export default async function Overview() {
  await requirePlatform();
  const d = await withSystem(async (db) => { const q = async (s: string) => (await db.query(s)).rows[0];
    return { t: await q("select count(*) filter (where status='trial') trial, count(*) filter (where status='active') active, count(*) filter (where status='past_due') pastdue, count(*) filter (where status='suspended') susp, count(*) total from tenants"),
      mrr: await q("select coalesce(sum(case when s.billing_interval='yearly' then pv.price_yearly_paise/12 else pv.price_monthly_paise end),0)::bigint v from subscriptions s join plan_versions pv on pv.id=s.plan_version_id where s.status='active'"),
      pay: await q("select count(*) filter (where status='failed' and created_at > now()-interval '7 days') failed, count(*) filter (where status='disputed') disputed, count(*) filter (where status='pending') pending from platform_payments"),
      jobs: await q("select count(*) filter (where status in ('failed','dead')) bad from jobs"), req: await q("select count(*) c from contact_requests where status='new'"), clos: await q("select count(*) c from closure_requests where status='requested'") }; });
  return (<><PageHead title="Overview" />
    {(Number(d.jobs.bad) > 0 || Number(d.clos.c) > 0) && <Alert tone="warn">{Number(d.jobs.bad) > 0 && <><Link href="/platform/jobs">{d.jobs.bad} failed background job(s)</Link>. </>}{Number(d.clos.c) > 0 && <>{d.clos.c} company closure request(s) waiting. </>}</Alert>}
    <div className="kpis"><Kpi label="Companies" value={d.t.total} hint={`${d.t.trial} trial · ${d.t.active} active`} /><Kpi label="Past due" value={d.t.pastdue} /><Kpi label="Suspended" value={d.t.susp} /><Kpi label="Recurring revenue / month (ex GST)" value={formatMoney(d.mrr.v)} /><Kpi label="Failed payments (7d)" value={d.pay.failed} /><Kpi label="Disputed" value={d.pay.disputed} /><Kpi label="New demo/contact requests" value={d.req.c} /></div></>);
}
