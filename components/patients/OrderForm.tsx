"use client";
import Link from "next/link";
import { useActionState } from "react";
import { placeOrder } from "@/app/(app)/lab/actions";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function OrderForm({ patients, defaultPatient }: { patients: Array<{ id: string; label: string }>; defaultPatient?: string }) {
  const [state, action] = useActionState(placeOrder, {} as { error?: string });
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      {state?.error ? <Alert tone="danger" title="Not placed">{state.error}</Alert> : null}
      <SelectField label="Patient" name="patient_id" defaultValue={defaultPatient ?? ""}><option value="">Choose a patient…</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</SelectField>
      <TextField label="Test or scan" name="test_name" hint="e.g. Full blood count, Chest X-ray" maxLength={200} />
      <div className="grid grid-cols-2 gap-5">
        <SelectField label="Type" name="kind"><option value="lab">Laboratory</option><option value="imaging">Imaging</option></SelectField>
        <SelectField label="Priority" name="priority"><option value="routine">Routine</option><option value="urgent">Urgent</option></SelectField>
      </div>
      <TextAreaField label="Clinical note" name="clinical_note" optional maxLength={500} />
      <div className="flex gap-3"><SubmitButton pendingLabel="Placing…">Place order</SubmitButton><Link href="/investigations" className="flex min-h-touch items-center px-3 font-bold">Cancel</Link></div>
    </form>
  );
}
