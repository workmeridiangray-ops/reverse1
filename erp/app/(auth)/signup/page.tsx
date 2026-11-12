import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
import { signupAction } from "@/lib/auth/actions";
export const metadata: Metadata = { title: "Start your free trial" };
export default function Signup() {
  return (
    <div className="card"><h1>Start your 14-day trial</h1>
      <p className="muted">Creates your company workspace with a chart of accounts, tax codes and a main branch. No card required.</p>
      <ActionForm action={signupAction} submit="Create company">
        <Field name="company" label="Company name" required placeholder="Sharma Traders Pvt Ltd" />
        <Field name="name" label="Your name" required autoComplete="name" />
        <Field name="email" label="Work email" type="email" required autoComplete="email" hint="We send a verification link here." />
        <Field name="password" label="Password" type="password" required autoComplete="new-password" hint="At least 10 characters with letters and a number." />
        <div className="field"><label className="row"><input type="checkbox" name="agree" required /> <span>I agree to the <Link href="/legal/terms">Terms</Link> and <Link href="/legal/privacy">Privacy Policy</Link></span></label></div>
      </ActionForm>
      <p className="small" style={{ marginTop: 16 }}>Already have an account? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
