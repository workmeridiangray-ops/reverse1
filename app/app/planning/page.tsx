import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, A, Field, Note, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { runMrpAction } from "../actions";
export const metadata = { title: "MRP" };
export default async function P() {
  const a = await requireCompany("plan.run");
  const runs = await rd(a, async (c) => (await c.query("select r.*, (select count(*) from mrp_suggestions s where s.run_id=r.id) n, (select count(*) from mrp_suggestions s where s.run_id=r.id and status='suggested') open from mrp_runs r order by created_at desc limit 30")).rows);
  return <Page title="Material requirements planning" sub="A planning run reads confirmed orders, net forecast, stock and open supply, then suggests purchases and jobs. Suggestions are not orders.">
    <Note>Assumptions are explicit: infinite capacity, lead times in working days, forecast netted against orders. Each run keeps a snapshot of its inputs.</Note>
    <div className="grid gap-4 lg:grid-cols-3"><Card title="Run planning"><ActionForm action={runMrpAction} submit="Run MRP"><Field label="Planning horizon (days)" name="horizon" type="number" defaultValue="90" required hint="1–365" /></ActionForm></Card>
      <div className="lg:col-span-2"><DataTable rows={runs} empty="No runs yet. Run planning after confirming orders." cols={[{ h: "Run", r: (r: any) => <A href={`/app/planning/${r.id}`}>{r.number}</A> }, { h: "When", r: (r: any) => dt(r.created_at) }, { h: "Horizon", r: (r: any) => `${r.params.horizonDays} d`, hideSm: true }, { h: "Suggestions", r: (r: any) => r.n, num: true }, { h: "Open", r: (r: any) => r.open, num: true }]} /></div></div></Page>;
}
