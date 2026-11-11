import { requirePlatform } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { Page, Stat, Card, DataTable, Badge, dt } from "@/components/ui";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Platform overview" };
export default async function P() {
  await requirePlatform();
  const n = async (s: string) => Number((await plat(s)).rows[0].n);
  const s = { biz: await n("select count(*) n from companies"), active: await n("select count(*) n from companies where status='active'"), trial: await n("select count(*) n from companies where status='trial'"), pastdue: await n("select count(*) n from companies where status in ('past_due','suspended')"),
    users: await n("select count(*) n from users"), dead: await n("select count(*) n from jobs where status in ('dead','failed')"), whfail: await n("select count(*) n from webhook_events where status='failed'"), tickets: await n("select count(*) n from support_tickets where status<>'resolved'"), mrr: await n("select coalesce(sum(case when s.cycle='monthly' then v.price_monthly_paise else v.price_yearly_paise/12 end),0) n from subscriptions s join plan_versions v on v.id=s.plan_version_id where s.status='active'") };
  const pay = (await plat("select status, count(*)::int n, coalesce(sum(amount_paise+tax_paise),0) amt from platform_invoices group by status order by status")).rows;
  const recent = (await plat("select at, action, actor_label from audit_log order by at desc limit 8")).rows;
  return <Page title="Platform overview" sub="Operational health of the software business.">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Businesses" value={s.biz} href="/admin/businesses" /><Stat label="Paying" value={s.active} /><Stat label="On trial" value={s.trial} /><Stat label="Past due / suspended" value={s.pastdue} tone={s.pastdue ? "text-warn" : ""} /><Stat label="Users" value={s.users} /><Stat label="MRR (est.)" value={formatINR(s.mrr)} /><Stat label="Failed jobs" value={s.dead} href="/admin/operations" tone={s.dead ? "text-danger" : ""} /><Stat label="Open tickets" value={s.tickets} href="/admin/support" /></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2"><Card title="Payments by status (incl. GST)"><DataTable rows={pay} empty="No invoices." cols={[{ h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "Count", r: (r: any) => r.n, num: true }, { h: "Amount", r: (r: any) => formatINR(r.amt), num: true }]} /></Card>
      <Card title="Recent platform activity"><DataTable rows={recent} cols={[{ h: "When", r: (r: any) => dt(r.at) }, { h: "Action", r: (r: any) => r.action }, { h: "By", r: (r: any) => r.actor_label ?? "system", hideSm: true }]} /></Card></div></Page>;
}
