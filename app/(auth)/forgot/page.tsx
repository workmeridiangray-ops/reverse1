import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { TextField } from "@/components/ui/Field";
import { requestReset } from "../actions";

export const metadata = { title: "Reset password" };
export default function Forgot() {
  return (
    <>
      <h1 className="mb-1 text-heading font-bold">Reset your password</h1>
      <p className="mb-4 text-ink-700">Enter your email and we will send a reset link.</p>
      <ActionForm action={requestReset} submitLabel="Send reset link" pendingLabel="Sending…">
        <TextField label="Email" name="email" type="email" autoComplete="username" />
      </ActionForm>
      <p className="mt-4 text-sm"><Link href="/login">Back to sign in</Link></p>
    </>
  );
}
