"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui/Layout";
import { TextField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signIn, type SignInState } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? <Alert tone="danger" title="Couldn't sign you in">{state.error}</Alert> : null}
      <input type="hidden" name="next" value={next} />
      <TextField label="Email" name="email" type="email" autoComplete="username" defaultValue={state.email} autoFocus />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" />
      <SubmitButton pendingLabel="Signing in…" className="w-full">Sign in</SubmitButton>
    </form>
  );
}
