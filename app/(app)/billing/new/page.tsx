import type { Metadata } from "next";
import { SelectField } from "@/components/ui/Field";
import { Alert, Card, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createInvoice } from "../actions";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ patient?: string; appointment?: string; error?: string }> }) {
  await requireRole("admin", "receptionist");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: patients } = await supabase.from("patients").select("id, mrn, given_name, family_name").is("archived_at", null).order("family_name").limit(1000);
  return (
    <>
      <PageHeader eyebrow="Billing" title="New invoice" description="Starts as a draft. Add items, then issue it to take payment." />
      {sp.error ? <div className="mb-gutter"><Alert tone="danger" title="Not created">{sp.error}</Alert></div> : null}
      <Card className="max-w-2xl">
        <form action={createInvoice} className="flex flex-col gap-5">
          {sp.appointment ? <input type="hidden" name="appointment_id" value={sp.appointment} /> : null}
          <SelectField label="Patient" name="patient_id" defaultValue={sp.patient ?? ""}>
            <option value="">Choose a patient…</option>
            {(patients ?? []).map((p) => <option key={p.id} value={p.id}>{p.family_name}, {p.given_name} · {p.mrn}</option>)}
          </SelectField>
          {sp.appointment ? <p className="text-sm text-ink-500">Linked to the selected visit.</p> : null}
          <div><SubmitButton pendingLabel="Creating…">Create draft invoice</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}
