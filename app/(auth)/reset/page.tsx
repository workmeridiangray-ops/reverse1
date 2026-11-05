import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { tx } from "@/lib/server/db";
import { sha256 } from "@/lib/server/auth";
import { resetPassword } from "../actions";

export const metadata = { title: "Choose a new password" };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const valid = token ? await tx({}, (db) => db.maybe("SELECT 1 FROM auth_tokens WHERE token_hash=$1 AND kind='reset' AND used_at IS NULL AND expires_at > now()", [sha256(token)])) : null;
  if (!valid) return (<><Alert tone="danger" title="This reset link is invalid or has expired." /><p className="mt-4"><Link href="/forgot">Request a new link</Link></p></>);
  return (
    <>
      <h1 className="mb-4 text-heading font-bold">Choose a new password</h1>
      <ActionForm action={resetPassword} submitLabel="Update password">
        <input type="hidden" name="token" value={token} />
        <TextField label="New password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters with letters and a number." minLength={10} />
        <TextField label="Confirm password" name="confirm" type="password" autoComplete="new-password" />
      </ActionForm>
    </>
  );
}
