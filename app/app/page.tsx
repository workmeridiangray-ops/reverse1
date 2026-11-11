import Link from "next/link";
import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Stat, Card, Note, A, Badge, date } from "@/components/ui";
import { can } from "@/lib/server/perms";
import { limitsOf, usageOf } from "@/lib/server/billing";
export const metadata = { title: "Dashboard" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const a = await requireCompany(); const role = a.membership.role;
  const d = await rd(a, async (c) => {
    const one = async (s: string) => Number((await c.query(s)).rows[0].n);
    return {
      openSO: await one("select count(*) n from sales_orders where status='confirmed'"),
      late: await one("select count(*) n from work_orders where status in ('planned','released','in_progress') and due_date < current_date"),
      wip: await one("select count(*) n from work_orders where status in ('released','in_progress')"),
      sugg: await one("select count(*) n from mrp_suggestions where status='suggested'"),
      qc: await one("select count(*) n from inspections where status='pending'"),
      ncr: await one("select count(*) n from ncrs where status='open'"),
      poAppr: await one("select count(*) n from purchase_orders where status='pending_approval'"),
      ecr: await one("select count(*) n from change_requests where status='pending'"),
      items: await one("select count(*) n from items"),
      ship: await one("select count(*) n from shipments where status='packing'"),
      dueSoon: (await c.query("select w.id, w.number, i.code, w.qty, w.due_date, w.status from work_orders w join items i on i.id=w.item_id where w.status in ('planned','released','in_progress') order by w.due_date limit 6")).rows,
    };
  });
  const lim = await limitsOf(a.company.id), use = await usageOf(a.company.id);
  const trialLeft = a.company.status === "trial" ? await (await import("@/lib/server/db")).plat("select trial_ends_at from companies where id=$1", [a.company.id]).then((r) => r.rows[0].trial_ends_at) : null;
  return <Page title={`Welcome, ${a.user.name.split(" ")[0]}`} sub="What needs attention right now.">
    {sp.sample && <Note tone="ok">Sample data loaded. It is demo data — delete it before go-live (Settings shows a demo marker until you clear it).</Note>}
    {d.items === 0 && can(role, "master.write") && <Note>You haven’t added any items yet. <A href="/app/onboarding">Follow the setup checklist</A> or load sample data to explore.</Note>}
    {trialLeft && <Note tone="warn">Trial ends {date(trialLeft)}. <A href="/app/settings/billing">Choose a plan</A> to keep access.</Note>}
    {a.company.status === "past_due" && <Note tone="danger">Payment is overdue. Access will be limited after the grace period. <A href="/app/settings/billing">Fix billing</A></Note>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Open customer orders" value={d.openSO} href="/app/sales" /><Stat label="Jobs in progress" value={d.wip} href="/app/production" />
      <Stat label="Late jobs" value={d.late} href="/app/production" tone={d.late ? "text-danger" : ""} /><Stat label="Planning suggestions" value={d.sugg} href="/app/planning" />
      <Stat label="Inspections pending" value={d.qc} href="/app/quality" /><Stat label="Open NCRs" value={d.ncr} href="/app/quality" tone={d.ncr ? "text-warn" : ""} />
      <Stat label="POs awaiting approval" value={d.poAppr} href="/app/purchasing" /><Stat label="Engineering changes pending" value={d.ecr} href="/app/changes" />
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-3">
      <Card title="Jobs by due date" className="lg:col-span-2" actions={<A href="/app/production">All jobs</A>}>
        {d.dueSoon.length === 0 ? <p className="text-sm text-muted">No open jobs.</p> : <ul className="divide-y divide-line text-sm">{d.dueSoon.map((w: any) => <li key={w.id} className="flex items-center justify-between gap-2 py-2"><Link className="font-medium text-brand" href={`/app/production/${w.id}`}>{w.number}</Link><span>{w.code} × {Number(w.qty)}</span><span className="text-muted">{date(w.due_date)}</span><Badge s={w.status} /></li>)}</ul>}
      </Card>
      <Card title="Plan usage"><ul className="space-y-2 text-sm"><li>{lim.plan} plan</li>{(["users", "plants", "items"] as const).map((k) => <li key={k} className="flex justify-between"><span className="capitalize">{k}</span><span className="num">{use[k]} / {lim[k]}</span></li>)}</ul></Card>
    </div>
  </Page>;
}
