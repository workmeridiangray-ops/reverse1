import Link from "next/link";
import type { Metadata } from "next";
import { Field, Flash, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Start your trial" };

export default async function Signup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const q = await searchParams;
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">Start your 14-day trial</h1>
      <p className="mt-1 text-muted">No card needed. You become the owner of a new company workspace.</p>
      <div className="mt-6"><Flash error={q.error} /></div>
      <form action={signUp} className="card space-y-4 p-6">
        <Field label="Your name" name="name"><TextInput name="name" required autoComplete="name" /></Field>
        <Field label="Company name" name="company"><TextInput name="company" required minLength={2} autoComplete="organization" placeholder="Acme Traders Pvt Ltd" /></Field>
        <Field label="Work email" name="email"><TextInput name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" name="password" hint="At least 10 characters."><TextInput name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <SubmitButton>Create workspace</SubmitButton>
      </form>
      <p className="mt-4 text-sm text-muted">Already have an account? <Link className="text-brand underline" href="/login">Sign in</Link></p>
    </main>
  );
}
