import { requirePlatform } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { Page, DataTable, Filters, Badge, Card, Field, Grid, Hidden, date } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { setCompanyStatus, extendTrial, requestSupportAccess } from "../actions";
export const metadata = { title: "Businesses" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatform("support", "billing"); const sp = await searchParams; const p: unknown[] = []; let w = "true"; if (sp.q) { p.push(`%${sp.q}%`); w = "(c.name ilike $1 or c.billing_email ilike $1)"; }
  const rows = (await plat(`select c.*, (select count(*)::int from memberships m where m.company_id=c.id and m.active) users, (select pl.name from subscriptions s join plan_versions v on v.id=s.plan_version_id join plans pl on pl.id=v.plan_id where s.company_id=c.id order by s.created_at desc limit 1) plan from companies c where ${w} order by c.created_at desc limit 100`, p)).rows;
  return <Page title="Businesses" sub="Tenant data is not visible here. Support can only enter a workspace after the owner approves a time-limited request.">
    <Filters action="/admin/businesses" q={sp.q} />
    <div className="space-y-3">{rows.length === 0 ? <Card><p className="text-sm">No businesses match.</p></Card> : rows.map((c: any) => <Card key={c.id} title={c.name} actions={<><Badge s={c.status} />{c.demo && <Badge s="warn" label="demo" />}</>}>
      <p className="text-sm text-muted">{c.billing_email} · {c.plan ?? "no plan"} · {c.users} users · created {date(c.created_at)}{c.trial_ends_at ? ` · trial ends ${date(c.trial_ends_at)}` : ""}</p>
      <details className="mt-2"><summary className="cursor-pointer text-sm text-brand">Account actions</summary><div className="mt-3 grid gap-3 lg:grid-cols-3">
        <ActionForm action={setCompanyStatus} submit="Apply status" small><Hidden name="id" value={c.id} /><Field label="Status" name="status" required options={["active", "suspended", "trial", "closed"].map((x) => ({ value: x, label: x }))} /><Field label="Reason (audited)" name="reason" required className="mt-2" /></ActionForm>
        <ActionForm action={extendTrial} submit="Extend trial" small secondary><Hidden name="id" value={c.id} /><Field label="Days" name="days" type="number" required /><Field label="Reason" name="reason" className="mt-2" /></ActionForm>
        <ActionForm action={requestSupportAccess} submit="Request support access" small secondary><Hidden name="company" value={c.id} /><Field label="Why do you need access?" name="reason" required /></ActionForm></div></details></Card>)}</div></Page>;
}
void Grid;
