"use client";
import Link from "next/link";
import { useActionState } from "react";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { savePatient, type PatientFormState } from "@/app/(app)/patients/actions";

export interface PatientFormValues {
  id?: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  sex_at_birth: string;
  phone: string;
  email: string;
  address: string;
  consent_treatment: boolean;
  consent_data_processing: boolean;
  consent_communication: boolean;
  consentOutdated: boolean;
}

export function PatientForm({ initial, consentVersion, today }: { initial: PatientFormValues; consentVersion: string; today: string }) {
  const [state, action] = useActionState<PatientFormState, FormData>(savePatient, {});
  const v = (k: keyof PatientFormValues) => (state.values?.[k] ?? (initial[k] as string | undefined) ?? "") as string;
  const checked = (k: "consent_treatment" | "consent_data_processing" | "consent_communication") =>
    state.values ? state.values[k] === "on" : initial[k];
  const e = state.errors ?? {};
  const errorCount = Object.keys(e).length;
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-section" noValidate>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {state.formError ? <Alert tone="danger" title="Not saved">{state.formError}</Alert> : null}
      {errorCount ? <Alert tone="danger" title={`Check ${errorCount} field${errorCount > 1 ? "s" : ""}`}>The problems are marked below.</Alert> : null}

      <fieldset className="grid gap-5 md:grid-cols-2">
        <legend className="mb-4 text-title font-bold">Identity</legend>
        <TextField label="Given name" name="given_name" defaultValue={v("given_name")} error={e.givenName} autoComplete="off" />
        <TextField label="Family name" name="family_name" defaultValue={v("family_name")} error={e.familyName} autoComplete="off" />
        <TextField label="Date of birth" name="date_of_birth" type="date" max={today} defaultValue={v("date_of_birth")} error={e.dateOfBirth} />
        <SelectField label="Sex at birth" name="sex_at_birth" defaultValue={v("sex_at_birth") || "unknown"} error={e.sexAtBirth}
          hint="Used later to pick the right lab reference ranges.">
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="intersex">Intersex</option>
          <option value="unknown">Unknown / not stated</option>
        </SelectField>
      </fieldset>

      <fieldset className="grid gap-5 md:grid-cols-2">
        <legend className="mb-4 text-title font-bold">Contact</legend>
        <TextField label="Phone" name="phone" type="tel" optional defaultValue={v("phone")} error={e.phone} />
        <TextField label="Email" name="email" type="email" optional defaultValue={v("email")} error={e.email} />
        <div className="md:col-span-2">
          <TextAreaField label="Address" name="address" optional defaultValue={v("address")} rows={2} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
        <legend className="px-1 text-title font-bold">Consent <span className="text-sm font-normal text-ink-500">(form {consentVersion})</span></legend>
        <p className="text-sm text-ink-700">Tick only what the patient has signed. Unticking records a withdrawal. Changes are written to the audit log.</p>
        <CheckboxField label="Consent to treatment" name="consent_treatment" defaultChecked={checked("consent_treatment")} hint="Required before the patient is seen." />
        <CheckboxField label="Consent to processing health data" name="consent_data_processing" defaultChecked={checked("consent_data_processing")} hint="Required. Covers storing and using their record in this clinic." />
        <CheckboxField label="Agrees to reminders by phone or email" name="consent_communication" defaultChecked={checked("consent_communication")} hint="Optional." />
        {initial.consentOutdated ? (
          <CheckboxField label={`Patient has re-signed on form ${consentVersion}`} name="consent_reconfirm" hint="Their consent is on an older form version." />
        ) : null}
      </fieldset>

      <div className="flex gap-3">
        <SubmitButton>{initial.id ? "Save changes" : "Register patient"}</SubmitButton>
        <Link href={initial.id ? `/patients/${initial.id}` : "/patients"} className="inline-flex min-h-touch items-center px-3 font-bold">Cancel</Link>
      </div>
    </form>
  );
}
