import { requireCompany } from "@/lib/server/auth";
import { rd, opts } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, date, dt, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { maintenanceAction } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Maintenance & downtime" };
export default async function P() {
  const a = await requireCompany("prod.read");
  const x = await rd(a, async (c) => ({
    pm: (await c.query("select m.*, w.code wc, (m.last_pm_at + m.pm_interval_days) due from machines m join work_centres w on w.id=m.work_centre_id order by due nulls last")).rows,
    req: (await c.query("select r.*, m.code mc from maintenance_requests r join machines m on m.id=r.machine_id order by r.created_at desc limit 30")).rows,
    dt: (await c.query("select d.*, w.code wc from downtime d join work_centres w on w.id=d.work_centre_id order by started_at desc limit 30")).rows,
    sum: (await c.query("select w.code, sum(d.minutes)::int m, count(*)::int n from downtime d join work_centres w on w.id=d.work_centre_id group by w.code order by m desc")).rows,
    machines: opts((await c.query("select id, code, name from machines order by code")).rows) }));
  const raise = can(a.membership.role, "shop.operate");
  return <Page title="Maintenance & downtime" sub="Bounded preventive-maintenance register linked to machines and downtime history.">
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Preventive maintenance register"><DataTable rows={x.pm} empty="No machines registered (Setup → Machines)." cols={[{ h: "Machine", r: (r: any) => r.code }, { h: "Work centre", r: (r: any) => r.wc, hideSm: true }, { h: "Every", r: (r: any) => (r.pm_interval_days ? `${r.pm_interval_days} d` : "—") }, { h: "Last PM", r: (r: any) => date(r.last_pm_at) }, { h: "Next due", r: (r: any) => (r.due ? <span className={new Date(r.due) < new Date() ? "text-danger" : ""}>{date(r.due)}</span> : "—") }]} /></Card>
      <Card title="Downtime by work centre"><DataTable rows={x.sum} empty="No downtime recorded." cols={[{ h: "Work centre", r: (r: any) => r.code }, { h: "Events", r: (r: any) => r.n, num: true }, { h: "Minutes", r: (r: any) => fmt(r.m, 0), num: true }]} /></Card>
      <Card title="Maintenance requests"><DataTable rows={x.req} empty="None." cols={[{ h: "Machine", r: (r: any) => r.mc }, { h: "Issue", r: (r: any) => r.description }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "", r: (r: any) => r.status !== "done" && raise ? <ActionForm action={maintenanceAction} submit="Close" small secondary><Hidden name="close" value={r.id} /></ActionForm> : null }]} />
        {raise && <ActionForm action={maintenanceAction} submit="Raise request" className="mt-3" resetOnOk><Grid><Field label="Machine" name="machine" required options={x.machines} /><Field label="What’s wrong / what’s needed" name="desc" required /></Grid></ActionForm>}</Card>
      <Card title="Downtime history"><DataTable rows={x.dt} empty="None." cols={[{ h: "When", r: (r: any) => dt(r.started_at) }, { h: "Work centre", r: (r: any) => r.wc }, { h: "Min", r: (r: any) => r.minutes, num: true }, { h: "Reason", r: (r: any) => r.reason }]} /></Card>
    </div></Page>;
}
