import Link from "next/link";
import { Alert } from "@/components/ui/Layout";
import { tx } from "@/lib/server/db";
import { sha256 } from "@/lib/server/auth";

export const metadata = { title: "Verify email" };
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const ok = await tx({}, async (db) => {
    const t = await db.maybe<{ id: string; user_id: string }>("SELECT id,user_id FROM auth_tokens WHERE token_hash=$1 AND kind='verify' AND used_at IS NULL AND expires_at > now() FOR UPDATE", [sha256(token)]);
    if (!t) return false;
    await db.exec("UPDATE auth_tokens SET used_at=now() WHERE id=$1", [t.id]);
    await db.exec("UPDATE users SET email_verified_at=now() WHERE id=$1", [t.user_id]);
    return true;
  });
  return (
    <main id="main" className="mx-auto max-w-prose px-4 py-24">
      {ok ? <Alert tone="ok" title="Email verified.">Thank you.</Alert> : <Alert tone="danger" title="This verification link is invalid or has expired.">Sign in and request a new one from your account page.</Alert>}
      <p className="mt-6"><Link href="/app">Continue</Link></p>
    </main>
  );
}
