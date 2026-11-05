"use client";
import { ActionForm } from "@/components/ui/ActionForm";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { submitLead } from "./forms";

export function LeadForm({ kind }: { kind: "demo" | "contact" }) {
  return (
    <ActionForm action={submitLead} submitLabel={kind === "demo" ? "Request demo" : "Send message"} pendingLabel="Sending…" reset className="max-w-xl">
      <input type="hidden" name="kind" value={kind} />
      <div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <TextField label="Your name" name="name" autoComplete="name" />
      <TextField label="Work email" name="email" type="email" autoComplete="email" />
      <TextField label="Company" name="company" optional autoComplete="organization" />
      <TextAreaField label={kind === "demo" ? "What would you like to see?" : "How can we help?"} name="message" optional />
    </ActionForm>
  );
}
