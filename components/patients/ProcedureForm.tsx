"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestProcedure } from "@/app/(app)/theatre/actions";
import { SelectField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function ProcedureForm({ patients, doctors, me }: { patients: Array<{ id: string; label: string }>; doctors: Array<{ id: string; name: string }>; me: string }) {
  const [state, action] = useActionState(requestProcedure, {} as { error?: string });
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      {state?.error ? <Alert tone="danger" title="Not requested">{state.error}</Alert> : null}
      <SelectField label="Patient" name="patient_id"><option value="">Choose a patient…</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</SelectField>
      <TextField label="Procedure" name="name" hint="e.g. Right hip revision" maxLength={200} />
      <SelectField label="Surgeon" name="surgeon_id" defaultValue={me}>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectField>
      <SelectField label="Urgency" name="urgency"><option value="elective">Elective</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></SelectField>
      <div className="flex gap-3"><SubmitButton pendingLabel="Requesting…">Request procedure</SubmitButton><Link href="/theatre" className="flex min-h-touch items-center px-3 font-bold">Cancel</Link></div>
    </form>
  );
}
