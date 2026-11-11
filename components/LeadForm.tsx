import { ActionForm } from "./ActionForm";
import { Field, Hidden } from "./ui";
import { leadAction } from "@/app/(auth)/actions";
export function LeadForm({ kind }: { kind: "demo" | "contact" }) {
  return <ActionForm action={leadAction} submit={kind === "demo" ? "Request demo" : "Send message"} className="card space-y-3 p-5" resetOnOk>
    <Hidden name="kind" value={kind} /><Field label="Your name" name="name" required /><Field label="Work email" name="email" type="email" required /><Field label="Company" name="company" />
    <Field label={kind === "demo" ? "What do you make? (optional)" : "Message"} name="message" type="textarea" required={kind === "contact"} />
    <div className="hidden" aria-hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
  </ActionForm>;
}
