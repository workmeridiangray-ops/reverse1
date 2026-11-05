import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText, DateText } from "@/components/ui/Format";
import { TextField } from "@/components/ui/Field";
import { Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requirePlatform } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { activateTenant, extendTrial, setTenantStatus } from "../../actions";

export const metadata = { title: "Business" };
export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await requirePlatform();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await tx({ userId: a.user.id, platform: true }, async (db) => {
    const t = await db.maybe<{ id: string; name: string; status: string; created_at: Date; trial_ends_at: Date | null; suspended_reason: string | null; plan: string; billing_cycle: string }>("SELECT t.id,t.name,t.status,t.created_at,t.trial_ends_at,t.suspended_reason,p.name plan,t.billing_cycle FROM tenants t JOIN plans p ON p.id=t.plan_id WHERE t.id=$1", [id]);
    if (!t) return null;
    return { t, owners: await db.q<{ name: string; email: string }>("SELECT u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='owner'", [id]),
      audit: await db.q<{ id: number; at: Date; action: string; detail: Record<string, unknown> }>("SELECT id,at,action,detail FROM audit_log WHERE tenant_id=$1 AND (action LIKE 'platform.%' OR action LIKE 'tenant.%' OR action LIKE 'plan.%' OR action LIKE 'billing.%') ORDER BY id DESC LIMIT 30", [id]) };
  });
  if (!d) notFound();
  const { t } = d; const hid = <input type="hidden" name="tenant_id" value={t.id} />;
  return (
    <>
      <PageHeader title={t.name} description={<span className="flex items-center gap-2"><Badge status={t.status} /> {t.plan} · {t.billing_cycle}</span>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account"><DefinitionList items={[["Created", <DateText key="c" at={t.created_at} />], ["Trial ends", <DateText key="t" at={t.trial_ends_at} />], ["Owners", d.owners.map((o) => `${o.name} <${o.email}>`).join("; ")], ["Suspension reason", t.suspended_reason ?? "—"]]} /></Card>
        <Card title="Actions">
          <div className="flex flex-col gap-6">
            {t.status !== "suspended" && t.status !== "closed" ? <ActionForm action={setTenantStatus} submitLabel="Suspend business" variant="secondary">{hid}<input type="hidden" name="status" value="suspended" /><TextField label="Reason (recorded in the audit log)" name="reason" id="sus-reason" /></ActionForm> : null}
            {t.status === "suspended" ? <ActionForm action={setTenantStatus} submitLabel="Reactivate business">{hid}<input type="hidden" name="status" value="active" /><TextField label="Reason" name="reason" id="re-reason" /></ActionForm> : null}
            {t.status === "trial" || t.status === "past_due" ? <ActionForm action={activateTenant} submitLabel="Activate (payment received)">{hid}<TextField label="Payment reference" name="payment_ref" hint="Bank UTR, invoice number or provider payment id" /></ActionForm> : null}
            {t.status === "trial" ? <ActionForm action={extendTrial} submitLabel="Extend trial" variant="secondary">{hid}<TextField label="Days" name="days" inputMode="numeric" defaultValue="7" /><TextField label="Reason" name="reason" id="trial-reason" /></ActionForm> : null}
          </div>
        </Card>
      </div>
      <Card title="Operator activity" className="mt-6"><Table caption="Platform activity"><thead><tr><Th>When</Th><Th>Action</Th><Th>Detail</Th></tr></thead><tbody>{d.audit.map((x) => <tr key={x.id}><Td><DateTimeText at={x.at} /></Td><Td className="font-bold">{x.action}</Td><Td className="font-mono text-caption">{JSON.stringify(x.detail)}</Td></tr>)}</tbody></Table></Card>
    </>
  );
}
