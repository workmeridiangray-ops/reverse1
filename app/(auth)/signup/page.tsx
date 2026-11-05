import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { CheckboxField, TextField } from "@/components/ui/Field";
import { signUp } from "../actions";

export const metadata = { title: "Start your free trial" };
export default async function Signup({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-heading font-bold">Start your 14-day trial</h1>
      <p className="mb-4 text-ink-700">No card needed. You become the business owner.</p>
      <ActionForm action={signUp} submitLabel="Create account" pendingLabel="Creating…">
        <input type="hidden" name="plan" value={plan ?? ""} />
        <TextField label="Your name" name="name" autoComplete="name" />
        <TextField label="Business name" name="business" autoComplete="organization" />
        <TextField label="Work email" name="email" type="email" autoComplete="email" />
        <TextField label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters with letters and a number." minLength={10} />
        <CheckboxField label="I accept the terms and privacy policy" name="terms" />
      </ActionForm>
      <p className="mt-4 text-sm">Already have an account? <Link href="/login">Sign in</Link></p>
    </>
  );
}
