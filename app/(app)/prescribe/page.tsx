import type { Metadata } from "next";
import { SelectField, TextField } from "@/components/ui/Field";
import { Alert, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { prescribe } from "../pharmacy/actions";

export const metadata: Metadata = { title: "Prescribe" };
export const dynamic = "force-dynamic";

export default async function Prescribe({ searchParams }: { searchParams: Promise<{ patient?: string; ok?: string; error?: string }> }) {
  await requireRole("doctor");
  const { patient, ok, error } = await searchParams;
  const supabase = await createClient();
  const [pts, meds] = await Promise.all([
    supabase.from("patients").select("id, mrn, given_name, family_name").is("archived_at", null).order("family_name").limit(1000),
    supabase.from("medicines").select("id, name, strength, form, controlled").eq("active", true).eq("on_formulary", true).order("name"),
  ]);
  return (
    <>
      <PageHeader eyebrow="Prescriptions" title="Prescribe" description="No interaction or allergy checking is built in. Check the patient's allergies yourself before prescribing." />
      <div className="mb-gutter flex flex-col gap-3">{error ? <Alert tone="danger" title="Not sent">{error}</Alert> : null}{ok ? <Alert tone="ok" title={ok} /> : null}</div>
      <form action={prescribe} className="flex max-w-2xl flex-col gap-5">
        <SelectField label="Patient" name="patient_id" defaultValue={patient ?? ""}><option value="">Choose a patient…</option>{(pts.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.family_name}, {p.given_name} ({p.mrn})</option>)}</SelectField>
        <SelectField label="Medicine" name="medicine_id"><option value="">Choose from the formulary…</option>{(meds.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength} {m.form}{m.controlled ? " (controlled)" : ""}</option>)}</SelectField>
        <div className="grid gap-5 md:grid-cols-3"><TextField label="Dose" name="dose" hint="e.g. 500 mg" /><TextField label="Route" name="route" hint="e.g. oral" /><TextField label="Frequency" name="frequency" hint="e.g. three times daily" /></div>
        <div className="grid gap-5 md:grid-cols-2"><TextField label="Days" name="days" inputMode="numeric" /><TextField label="Total quantity to supply" name="qty" inputMode="numeric" /></div>
        <SubmitButton pendingLabel="Sending…">Send to pharmacy</SubmitButton>
      </form>
    </>
  );
}
