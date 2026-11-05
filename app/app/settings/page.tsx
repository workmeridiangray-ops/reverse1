import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Money, DateText } from "@/components/ui/Format";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { requireCtx } from "@/lib/server/auth";
import { tenantLimits } from "@/lib/server/queries";
import { changePlan, requestActivation, saveBusiness } from "./actions";

export const metadata = { title: "Settings" };
export default async function Settings({ searchParams }: { searchParams: Promise<{ locked?: string }> }) {
  const c = await requireCtx("settings.manage", { allowLocked: true });
  const { locked } = await searchParams;
  const { t, lim, plans, history } = await c.run(async (db) => ({
    t: await db.one<{ name: string; gstin: string | null; address: string | null; status: string; billing_cycle: string; trial_ends_at: Date | null; plan_id: string; created_at: Date }>("SELECT name,gstin,address,status,billing_cycle,trial_ends_at,plan_id,created_at FROM tenants WHERE id=$1", [c.tenant.id]),
    lim: await tenantLimits(db, c.tenant.id),
    plans: await db.q<{ id: string; name: string; price_month_minor: number; price_year_minor: number; max_projects: number; max_users: number; storage_mb: number }>("SELECT id,name,price_month_minor,price_year_minor,max_projects,max_users,storage_mb FROM plans WHERE active ORDER BY price_month_minor"),
    history: await db.q<{ at: Date; pname: string }>("SELECT pc.at,p.name pname FROM plan_changes pc JOIN plans p ON p.id=pc.to_plan_id ORDER BY pc.at DESC LIMIT 10"),
  }));
  const bar = (used: number, max: number) => <progress className="h-2 w-full" value={used} max={max} aria-label={`${used} of ${max}`} />;
  return (
    <>
      <PageHeader title="Settings" description="Business details, plan, usage and data export." />
      {locked || c.tenant.lockReason ? <div className="mb-6"><Alert tone="danger" title="Workspace is read-only">{c.tenant.lockReason}</Alert></div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Business details"><ActionForm action={saveBusiness} submitLabel="Save">
          <TextField label="Business name" name="name" defaultValue={t.name} /><TextField label="GSTIN" name="gstin" defaultValue={t.gstin ?? ""} optional /><TextAreaField label="Address" name="address" defaultValue={t.address ?? ""} optional /></ActionForm></Card>
        <Card title="Current plan and usage">
          <DefinitionList items={[["Plan", <span key="p" className="flex gap-2">{lim.plan} <Badge status={t.status} /></span>], ["Billing cycle", t.billing_cycle], ["Trial ends", <DateText key="t" at={t.trial_ends_at} />], ["Customer since", <DateText key="c" at={t.created_at} />]]} />
          <div className="mt-4 space-y-3 text-sm">
            <div><p>Open projects: {lim.projects} / {lim.max_projects}</p>{bar(lim.projects, lim.max_projects)}</div>
            <div><p>Users and pending invitations: {lim.users} / {lim.max_users}</p>{bar(lim.users, lim.max_users)}</div>
            <div><p>Storage: {(lim.storage_bytes / 1048576).toFixed(1)} MB / {lim.storage_mb} MB</p>{bar(lim.storage_bytes / 1048576, lim.storage_mb)}</div>
          </div>
        </Card>
        <Card title="Change plan">
          <ActionForm action={changePlan} submitLabel="Switch plan">
            <SelectField label="Plan" name="plan_id" defaultValue={t.plan_id}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} — ₹{(p.price_month_minor / 100).toLocaleString("en-IN")}/mo · {p.max_projects} projects · {p.max_users} users</option>)}</SelectField>
            <SelectField label="Billing cycle" name="cycle" defaultValue={t.billing_cycle}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></SelectField>
            <p className="text-sm text-ink-700">Downgrades are refused until your projects, users and storage fit the new plan; the message says exactly what to resolve. Plan versions keep earlier billing unchanged.</p>
          </ActionForm>
        </Card>
        <Card title="Billing">
          <Alert tone="warn" title="Online payment is not configured on this deployment">Subscription payments need a payment provider connected by the operator. Until then, activation and invoicing are arranged with the {`operator`} team.</Alert>
          {t.status === "trial" ? <div className="mt-4"><ActionForm action={requestActivation} submitLabel="Request paid activation"><p className="text-sm text-ink-700">Sends an activation request to the operator.</p></ActionForm></div> : null}
          <h3 className="mb-2 mt-4 font-bold">Plan history</h3>
          <ul className="text-sm">{history.map((h, i) => <li key={i}><DateText at={h.at} /> — {h.pname}</li>)}</ul>
        </Card>
        <Card title="Export and closure">
          <p className="mb-3 text-ink-700">Download a JSON export of your projects, BOQ, contracts, measurements, bills, invoices, receipts and variations. Project-level BOQ and bill CSVs are on each project.</p>
          <ButtonLink href="/api/export-tenant" icon="file">Export all data (JSON)</ButtonLink>
        </Card>
      </div>
      <p className="mt-6 hidden"><Money minor={0} /></p>
    </>
  );
}
