"use client";
import { useActionState } from "react";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { type DemoState, requestDemo } from "./actions";

export function DemoForm() {
  const [state, action] = useActionState<DemoState, FormData>(requestDemo, {});
  if (state.status) {
    return <Alert tone="ok" title={state.status === "duplicate" ? "We already have your request" : "Thank you, we have your request"}>
      {state.status === "duplicate" ? "You asked recently, so we have not created a second one. We will be in touch." : "We will reply by email. Nothing else is needed from you."}</Alert>;
  }
  const e = state.errors ?? {};
  const v = (k: string) => state.values?.[k] ?? "";
  return (
    <form action={action} className="flex max-w-xl flex-col gap-5" noValidate>
      {state.formError ? <Alert tone="danger" title="Not sent">{state.formError}</Alert> : null}
      <TextField label="Your name" name="name" defaultValue={v("name")} error={e.name} autoComplete="name" />
      <TextField label="Work email" name="email" type="email" defaultValue={v("email")} error={e.email} autoComplete="email" />
      <TextField label="Organisation" name="organisation" defaultValue={v("organisation")} error={e.organisation} autoComplete="organization" />
      <TextField label="Approximate beds" name="beds" inputMode="numeric" defaultValue={v("beds")} error={e.beds} optional />
      <TextAreaField label="Anything we should know?" name="message" defaultValue={v("message")} optional maxLength={2000} />
      <div aria-hidden="true" className="absolute -left-[9999px]"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
    </form>
  );
}
