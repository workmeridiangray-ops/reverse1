import Link from "next/link";
import type { Metadata } from "next";
import { Field, Flash, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; next?: string }> }) {
  const q = await searchParams;
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <div className="mt-6"><Flash ok={q.ok} error={q.error} /></div>
      <form action={signIn} className="card space-y-4 p-6">
        <input type="hidden" name="next" value={q.next ?? ""} />
        <Field label="Work email" name="email"><TextInput name="email" type="email" required autoComplete="email" placeholder="you@company.in" /></Field>
        <Field label="Password" name="password"><TextInput name="password" type="password" required autoComplete="current-password" /></Field>
        <SubmitButton>Sign in</SubmitButton>
      </form>
      <p className="mt-4 text-sm text-muted">New here? <Link className="text-brand underline" href="/signup">Start a free trial</Link></p>
    </main>
  );
}
