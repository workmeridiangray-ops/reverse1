import { Card, PageHeader } from "@/components/ui/Layout";
import { Stat } from "@/components/ui/Stat";
import { requirePlatform } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";

export const metadata = { title: "Platform overview" };
export default async function Overview() {
  const a = await requirePlatform();
  const d = await tx({ userId: a.user.id, platform: true }, async (db) => ({
    t: await db.q<{ status: string; n: number }>("SELECT status,count(*)::int n FROM tenants GROUP BY 1"),
    u: (await db.one<{ n: number }>("SELECT count(*)::int n FROM users")).n,
    failed: (await db.one<{ n: number }>("SELECT count(*)::int n FROM email_outbox WHERE status='failed'")).n,
    pending: (await db.one<{ n: number }>("SELECT count(*)::int n FROM email_outbox WHERE status='pending'")).n,
    leads: (await db.one<{ n: number }>("SELECT count(*)::int n FROM leads WHERE created_at > now() - interval '7 days'")).n,
  }));
  return (
    <>
      <PageHeader title="Platform overview" description="Operator view. Customer project data is not readable from this console." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {d.t.map((x) => <Stat key={x.status} label={`Businesses: ${x.status}`} value={x.n} />)}
        <Stat label="Users" value={d.u} /><Stat label="Failed email jobs" value={d.failed} hint={`${d.pending} pending`} /><Stat label="Leads (7 days)" value={d.leads} />
      </div>
      <Card title="Operating notes" className="mt-6"><ul className="list-disc pl-5 text-ink-700"><li>Suspend or activate businesses from their detail page; every change needs a reason and is audited.</li><li>Failed background jobs are listed under Background jobs with a safe retry.</li></ul></Card>
    </>
  );
}
