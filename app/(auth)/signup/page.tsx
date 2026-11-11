import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { signupAction } from "../actions";
export const metadata = { title: "Start your free trial" };
export default function P() {
  return <AuthCard title="Start your 14-day free trial" sub="No card needed. You’ll be the business owner of the new workspace." foot={<>Already have an account? <Link className="text-brand underline" href="/login">Sign in</Link></>}>
    <ActionForm action={signupAction} submit="Create workspace" className="space-y-3">
      <Field label="Your name" name="name" required placeholder="Asha Rao" /><Field label="Work email" name="email" type="email" required placeholder="asha@yourcompany.com" />
      <Field label="Company name" name="company" required placeholder="Rao Precision Works" />
      <Field label="Password" name="password" type="password" required hint="At least 10 characters, with letters and a number." />
      <div className="hidden" aria-hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" className="mt-1 h-4 w-4" /> <span>I agree to the <Link className="text-brand underline" href="/legal/terms">terms</Link> and <Link className="text-brand underline" href="/legal/privacy">privacy policy</Link>.</span></label>
    </ActionForm></AuthCard>;
}
