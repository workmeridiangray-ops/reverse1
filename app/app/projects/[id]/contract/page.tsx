import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { TextField } from "@/components/ui/Field";
import { Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { Money, DateTimeText } from "@/components/ui/Format";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { formatPercent } from "@/lib/rules/qty";
import { toMajorString } from "@/lib/rules/money";
import { approveContract, saveContract } from "./actions";

export const metadata = { title: "Contract" };
interface K { contract_no: string; status: string; retention_bp: number; retention_cap_bp: number; advance_minor: number; advance_recovery_bp: number; payment_days: number; approved_at: Date | null; snapshot: { contractValueMinor: number; boqSha256: string } | null }
export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("project.view");
  const { p, k } = await c.run(async (db) => ({ p: await getProject(db, id), k: await db.maybe<K>("SELECT contract_no,status,retention_bp,retention_cap_bp,advance_minor,advance_recovery_bp,payment_days,approved_at,snapshot FROM contracts WHERE project_id=$1", [id]) }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const editable = c.can("contract.edit") && p.status !== "closed" && (!k || k.status === "draft");
  return (
    <>
      <PageHeader eyebrow={p.code} title="Contract and commercial terms" description="Retention, advance and recovery are recorded separately and frozen when the contract is approved." />
      <ProjectTabs c={c} id={id} active="contract" />
      {k && k.status === "approved" ? (
        <Card title="Approved contract" actions={<Badge status="approved" />}>
          <DefinitionList items={[
            ["Contract no.", k.contract_no], ["Approved", <DateTimeText key="a" at={k.approved_at} />],
            ["Contract value at approval", <Money key="v" minor={k.snapshot?.contractValueMinor ?? 0} />],
            ["Retention", `${formatPercent(k.retention_bp)} (cap ${formatPercent(k.retention_cap_bp)} of contract value)`],
            ["Advance", <span key="ad"><Money minor={k.advance_minor} /> recovered at {formatPercent(k.advance_recovery_bp)} of each certified bill</span>],
            ["Payment terms", `${k.payment_days} days from invoice`], ["BOQ fingerprint", <code key="h" className="break-all text-caption">{k.snapshot?.boqSha256}</code>],
          ]} />
        </Card>
      ) : editable ? (
        <div className="grid max-w-3xl gap-6">
          <Card title="Commercial terms">
            <ActionForm action={saveContract} submitLabel="Save terms">
              {hid}
              <TextField label="Contract number" name="contract_no" defaultValue={k?.contract_no ?? ""} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Retention (%)" name="retention" inputMode="decimal" defaultValue={k ? String(k.retention_bp / 100) : "5"} hint="Held from each certified bill" />
                <TextField label="Retention cap (% of contract value)" name="retention_cap" inputMode="decimal" defaultValue={k ? String(k.retention_cap_bp / 100) : "5"} />
                <TextField label="Mobilisation advance (₹)" name="advance" inputMode="decimal" defaultValue={k ? toMajorString(k.advance_minor, "INR") : "0"} />
                <TextField label="Advance recovery (% of each certified bill)" name="recovery" inputMode="decimal" defaultValue={k ? String(k.advance_recovery_bp / 100) : "10"} />
                <TextField label="Payment terms (days)" name="payment_days" inputMode="numeric" defaultValue={k ? String(k.payment_days) : "30"} />
              </div>
            </ActionForm>
          </Card>
          {k && c.can("contract.approve") ? (
            <Card title="Approve contract"><ActionForm action={approveContract} submitLabel="Approve and freeze" variant="primary">{hid}<p className="text-ink-700">Approval snapshots the commercial terms and BOQ. This cannot be undone; later changes need variations.</p></ActionForm></Card>
          ) : null}
        </div>
      ) : (
        <Card><p className="text-ink-700">{k ? "The contract is in draft." : "No contract has been recorded for this project yet."}</p></Card>
      )}
      <p className="mt-6 max-w-prose text-sm text-ink-500">This register supports evidence and approvals. It does not interpret contract clauses, adjudicate claims or draft legal documents. Contract amendments and renewals are not part of this release.</p>
    </>
  );
}
