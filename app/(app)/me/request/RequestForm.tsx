"use client";
import { useActionState } from "react";
import { createRequest, type RequestState } from "@/app/(app)/me/actions";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function RequestForm() {
  const [state, action] = useActionState<RequestState, FormData>(createRequest, {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="flex max-w-xl flex-col gap-5" noValidate>
      {e.form ? <Alert tone="warn" title="Can't send another request yet">{e.form}</Alert> : null}
      <TextField label="When suits you?" name="preferred" defaultValue={state.values?.preferred} error={e.preferred} maxLength={300} hint="For example: Tuesday or Wednesday mornings next week" />
      <TextAreaField label="What is the visit for?" name="reason" defaultValue={state.values?.reason} error={e.reason} rows={3} maxLength={500} />
      <p className="text-sm text-ink-700">This is a request, not a booking. The clinic will confirm a time with you. For anything urgent, phone the clinic.</p>
      <div><SubmitButton pendingLabel="Sending…">Send request</SubmitButton></div>
    </form>
  );
}
