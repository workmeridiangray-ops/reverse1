import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { requireUser } from "@/lib/server/auth";
import { logoutAction } from "../actions";
export const metadata = { title: "Workspace suspended" };
export default async function P() {
  const a = await requireUser(); const owner = a.membership?.role === "owner";
  return <AuthCard title="This workspace is suspended" sub={a.company?.name}>
    <p className="text-sm text-muted">Access is paused because your trial has ended, a subscription is unpaid, or an administrator placed a hold. Your data is safe and unchanged.</p>
    {owner ? <Link href="/app/settings/billing" className="btn-primary mt-4">Resolve billing</Link> : <p className="mt-3 text-sm">Ask your company owner to resolve billing, or <Link className="underline" href="/contact">contact support</Link>.</p>}
    <div className="mt-4 flex gap-4 text-sm"><Link className="text-brand underline" href="/workspaces">Switch workspace</Link><form action={logoutAction}><button className="text-brand underline">Sign out</button></form></div>
  </AuthCard>;
}
