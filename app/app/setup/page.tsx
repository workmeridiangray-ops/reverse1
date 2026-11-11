import { requireCompany } from "@/lib/server/auth";
import { rd, opts } from "@/lib/server/read";
import { Page, Card, DataTable, Field, Grid, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { savePlant, saveLocation, saveWorkCentre, saveMachine, saveShift } from "../actions";
import { can } from "@/lib/server/perms";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Plants & work centres" };
export default async function P() {
  const a = await requireCompany("master.read");
  const d = await rd(a, async (c) => ({ plants: (await c.query("select * from plants order by code")).rows, locs: (await c.query("select l.*, p.code pc from locations l join plants p on p.id=l.plant_id order by l.code")).rows,
    wcs: (await c.query("select w.*, p.code pc from work_centres w join plants p on p.id=w.plant_id order by w.code")).rows, machines: (await c.query("select m.*, w.code wc from machines m join work_centres w on w.id=m.work_centre_id order by m.code")).rows,
    cal: (await c.query("select plant_id, weekday, working from shift_calendar")).rows }));
  const w = can(a.membership.role, "master.write"); const po = opts(d.plants); const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return <Page title="Plants, warehouses & work centres" sub="Plant and location context is shown on every stock and job screen.">
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Plants"><DataTable rows={d.plants} empty="Add your first plant." cols={[{ h: "Code", r: (r: any) => r.code }, { h: "Name", r: (r: any) => r.name }]} />
        {w && <ActionForm action={savePlant} submit="Add plant" className="mt-3" resetOnOk><Grid><Field label="Code" name="code" required placeholder="PUNE1" /><Field label="Name" name="name" required /></Grid></ActionForm>}</Card>
      <Card title="Warehouses & bins"><DataTable rows={d.locs} empty="Add a stock location, plus one of type quarantine." cols={[{ h: "Code", r: (r: any) => r.code }, { h: "Plant", r: (r: any) => r.pc }, { h: "Kind", r: (r: any) => <Badge s={r.kind === "quarantine" ? "quarantine" : "neutral"} label={r.kind} /> }]} />
        {w && <ActionForm action={saveLocation} submit="Add location" className="mt-3" resetOnOk><Grid><Field label="Plant" name="plant" required options={po} /><Field label="Kind" name="kind" options={["stock", "quarantine", "wip", "dispatch"].map((x) => ({ value: x, label: x }))} /><Field label="Code" name="code" required /><Field label="Name" name="name" required /></Grid></ActionForm>}</Card>
      <Card title="Work centres"><DataTable rows={d.wcs} empty="Add a work centre." cols={[{ h: "Code", r: (r: any) => r.code }, { h: "Plant", r: (r: any) => r.pc, hideSm: true }, { h: "Hrs/day", r: (r: any) => Number(r.hours_per_day), num: true }, { h: "Rate/hr", r: (r: any) => formatINR(r.cost_rate_per_hour_paise), num: true }, { h: "OH %", r: (r: any) => Number(r.overhead_pct), num: true }]} />
        {w && <ActionForm action={saveWorkCentre} submit="Add work centre" className="mt-3" resetOnOk><Grid><Field label="Plant" name="plant" required options={po} /><Field label="Code" name="code" required /><Field label="Name" name="name" required /><Field label="Hours per day" name="hours" type="number" defaultValue="8" /><Field label="Cost rate per hour (₹)" name="rate" placeholder="600.00" /><Field label="Overhead %" name="overhead" type="number" defaultValue="0" /></Grid></ActionForm>}</Card>
      <Card title="Machines"><DataTable rows={d.machines} empty="No machines yet." cols={[{ h: "Code", r: (r: any) => r.code }, { h: "Work centre", r: (r: any) => r.wc }, { h: "PM every", r: (r: any) => (r.pm_interval_days ? `${r.pm_interval_days} d` : "—") }]} />
        {w && <ActionForm action={saveMachine} submit="Add machine" className="mt-3" resetOnOk><Grid><Field label="Work centre" name="wc" required options={opts(d.wcs)} /><Field label="Code" name="code" required /><Field label="Name" name="name" required /><Field label="Preventive maintenance interval (days)" name="pm" type="number" /></Grid></ActionForm>}</Card>
    </div>
    {d.plants.map((p: any) => <Card key={p.id} title={`Shift calendar — ${p.code}`} className="mt-4">{w ? <ActionForm action={saveShift} submit="Save calendar" small secondary><input type="hidden" name="plant" value={p.id} /><div className="flex flex-wrap gap-4">{days.map((n, i) => <label key={n} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`d${i}`} defaultChecked={d.cal.find((x: any) => x.plant_id === p.id && x.weekday === i)?.working ?? (i >= 1 && i <= 5)} className="h-5 w-5" />{n}</label>)}</div></ActionForm>
      : <p className="text-sm text-muted">Working days: {days.filter((_, i) => d.cal.find((x: any) => x.plant_id === p.id && x.weekday === i)?.working).join(", ") || "Mon–Fri (default)"}</p>}</Card>)}
  </Page>;
}
