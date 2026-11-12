import Link from "next/link";
import { verifyEmailToken } from "@/lib/auth/actions";
import { Alert } from "@/components/ui";
export const metadata = { title: "Verify email" };
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string; sent?: string }> }) {
  const sp = await searchParams;
  if (sp.token) {
    const r = await verifyEmailToken(sp.token);
    return (<div className="card"><h1>{r === "ok" ? "Email verified" : "Link not valid"}</h1>
      {r === "ok" ? <><Alert tone="ok">Your email is confirmed.</Alert><Link className="btn primary" href="/login">Sign in</Link></>
        : <><Alert tone="bad">This link has expired or was already used.</Alert><p>Sign in to request a new verification link.</p><Link className="btn" href="/login">Go to sign in</Link></>}</div>);
  }
  return (<div className="card"><h1>Check your email</h1><p>We sent a verification link to your address. It works for 2 days. Once verified, sign in to open your workspace.</p><Link className="btn" href="/login">Go to sign in</Link></div>);
}
