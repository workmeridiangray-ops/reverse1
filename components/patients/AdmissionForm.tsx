"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { type AdmissionFormState, createAdmission } from "@/app/(app)/admissions/actions";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function AdmissionForm({ patients, doctors, requireDeposit, defaultPatient }: {
  patients: Array<{ id: string; label: string }>; doctors: Array<{ id: string; name: string }>; requireDeposit: boolean; defaultPatient?: string;
}) {
  const [state, action] = useActionState<AdmissionFormState, FormData>(createAdmission, {});
  const [type, setType] = useState(state.values?.admission_type ?? "elective");
  const v = (k: string) => state.values?.[k] ?? "";
  const e = state.errors ?? {};
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5" noValidate>
      {state.formError ? <Alert tone="danger" title="Not saved">{state.formError}</Alert> : null}
      {Object.keys(e).length ? <Alert tone="danger" title="Check the marked fields" /> : null}
      <SelectField label="Patient" name="patient_id" defaultValue={v("patient_id") || defaultPatient || ""} error={e.patient_id}>
        <option value="">Choose a patient…</option>
        {patients.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </SelectField>
      <SelectField label="Attending doctor" name="attending_id" defaultValue={v("attending_id")} error={e.attending_id}>
        <option value="">Choose a doctor…</option>
        {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </SelectField>
      <SelectField label="Type" name="admission_type" value={type} onChange={(ev) => setType(ev.target.value)} error={e.admission_type}
        hint="Emergency admissions are never held up by a deposit.">
        <option value="elective">Elective (planned)</option>
        <option value="emergency">Emergency</option>
      </SelectField>
      <TextAreaField label="Reason for admission" name="reason" defaultValue={v("reason")} error={e.reason} maxLength={500} />
      <TextField label="Deposit reference" name="deposit_reference" defaultValue={v("deposit_reference")} error={e.deposit_reference}
        optional={type === "emergency" || !requireDeposit} hint="Receipt or reference number from the cashier, e.g. DEP-1042." />
      <TextField label="Expected discharge date" name="expected_discharge_on" type="date" defaultValue={v("expected_discharge_on")} optional />
      <div className="flex gap-3">
        <SubmitButton pendingLabel="Requesting…">Request admission</SubmitButton>
        <Link href="/admissions" className="flex min-h-touch items-center px-3 font-bold">Cancel</Link>
      </div>
    </form>
  );
}
