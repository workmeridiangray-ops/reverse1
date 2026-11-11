"use client";
import { useActionState } from "react";
import { updateDetails, type DetailsState } from "@/app/(app)/me/actions";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function DetailsForm({ initial }: { initial: { phone: string; email: string; address: string; communication: boolean } }) {
  const [state, action] = useActionState<DetailsState, FormData>(updateDetails, {});
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  return (
    <form action={action} className="flex max-w-xl flex-col gap-5" noValidate>
      {e.form ? <Alert tone="danger" title="Not saved">{e.form}</Alert> : null}
      <TextField label="Phone" name="phone" type="tel" optional defaultValue={v.phone} error={e.phone} />
      <TextField label="Email" name="email" type="email" optional defaultValue={v.email} error={e.email} />
      <TextAreaField label="Address" name="address" optional defaultValue={v.address} error={e.address} rows={2} />
      <CheckboxField label="The clinic may remind me about appointments by phone or email" name="communication" defaultChecked={v.communication} hint="You can change this at any time." />
      <p className="text-sm text-ink-700">To change your name, date of birth or consent to treatment, please speak to the front desk.</p>
      <div><SubmitButton>Save my details</SubmitButton></div>
    </form>
  );
}
