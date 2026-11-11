import type { Metadata } from "next";
import Link from "next/link";
import { CheckboxField, SelectField, TextField } from "@/components/ui/Field";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { getWardsForSetup } from "@/lib/data/inpatient";
import { createClient } from "@/lib/supabase/server";
import { saveBed, savePolicy, saveWard } from "../actions";

export const metadata: Metadata = { title: "Wards and beds setup" };
export const dynamic = "force-dynamic";
const KINDS = ["general", "surgical", "maternity", "paediatric", "icu", "emergency", "other"];

export default async function WardSetup({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const [{ wards, beds }, clinic] = await Promise.all([
    getWardsForSetup(supabase),
    supabase.from("clinics").select("require_deposit_for_elective, emergency_requires_finance_clearance").eq("id", session.clinic.id).single(),
  ]);
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Wards and beds" description={<Link href="/wards">Back to ward census</Link>} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <div className="grid gap-gutter xl:grid-cols-[1fr_26rem]">
        <div className="flex flex-col gap-gutter">
          {wards.length === 0 ? <EmptyState title="No wards yet">Add a ward, then its beds.</EmptyState> : null}
          {wards.map((w) => (
            <Card key={w.id} title={w.name}>
              <form action={saveWard} className="mb-5 flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={w.id} />
                <TextField label="Name" id={`wn-${w.id}`} name="name" defaultValue={w.name} />
                <SelectField label="Type" id={`wk-${w.id}`} name="kind" defaultValue={w.kind}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</SelectField>
                <CheckboxField label="Open" name={`active`} id={`wa-${w.id}`} defaultChecked={w.active} />
                <SubmitButton size="sm" variant="secondary">Save ward</SubmitButton>
              </form>
              <ul className="mb-5 flex flex-col gap-2">
                {beds.filter((b) => b.ward_id === w.id).map((b) => (
                  <li key={b.id}>
                    <form action={saveBed} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="ward_id" value={w.id} />
                      <TextField label="Bed" id={`bl-${b.id}`} name="label" defaultValue={b.label} />
                      <CheckboxField label="Out of service" name="out_of_service" id={`bo-${b.id}`} defaultChecked={b.out_of_service} />
                      <SubmitButton size="sm" variant="secondary">Save bed</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={saveBed} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <input type="hidden" name="ward_id" value={w.id} />
                <TextField label="New bed label" id={`nb-${w.id}`} name="label" hint="e.g. W1-05" />
                <SubmitButton size="sm">Add bed</SubmitButton>
              </form>
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-gutter">
          <Card title="Add a ward">
            <form action={saveWard} className="flex flex-col gap-4">
              <TextField label="Name" id="new-ward-name" name="name" />
              <SelectField label="Type" id="new-ward-kind" name="kind">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</SelectField>
              <SubmitButton>Add ward</SubmitButton>
            </form>
          </Card>
          <Card title="Admission policy">
            <p className="mb-4 text-ink-700">The hospital decides these rules. They apply to new requests and to discharge checks straight away.</p>
            <form action={savePolicy} className="flex flex-col gap-4">
              <CheckboxField label="Elective admissions need a deposit reference" name="require_deposit_for_elective" defaultChecked={clinic.data?.require_deposit_for_elective ?? true} />
              <CheckboxField label="Emergency discharges also need finance clearance" name="emergency_requires_finance_clearance" defaultChecked={clinic.data?.emergency_requires_finance_clearance ?? false} hint="Off by default so payment never delays emergency care." />
              <SubmitButton>Save policy</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
