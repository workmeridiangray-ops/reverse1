import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { act, must, str } from "@/lib/action";
import { Flash, PageHeader, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import Link from "next/link";

export const metadata: Metadata = { title: "Platform admin" };

async function setStatus(f: FormData) {
  "use server";
  await act("/platform", "/platform", "Workspace status updated", async (sb) => { must(await sb.rpc("admin_set_tenant_status", { p_tenant: str(f, "id"), p_status: str(f, "status"), p_note: str(f, "note") })); });
}

export default async function Platform({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx();
  if (!ctx.isPlatformAdmin) redirect("/app");
  const sb = await createClient();
  const { data } = await sb.rpc("admin_list_tenants");
  const rows = (data as any[]) ?? [];
  return (
    <main id="main" className="mx-auto max-w-page p-4 md:p-8">
      <PageHeader title="Platform admin" sub="Subscriber accounts only. Customer business documents are not visible here." actions={<Link className="btn" href="/app">Back to workspace</Link>} />
      <Flash ok={q.ok} error={q.error} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {["trial", "active", "past_due", "suspended"].map((s) => <div key={s} className="card p-4"><p className="text-sm text-muted">{s.replace("_", " ")}</p><p className="text-2xl font-semibold">{rows.filter((r) => r.status === s).length}</p></div>)}
      </div>
      <Table head={["Workspace", "Plan", "Status", "Members", "Trial ends", "Action"]} numeric={[3]}>
        {rows.map((r) => (
          <tr key={r.id}><td className="td font-medium">{r.name}</td><td className="td">{r.plan_code}</td><td className="td"><Status value={r.status} /></td><td className="td num">{r.members}</td><td className="td">{String(r.trial_ends_at).slice(0, 10)}</td>
            <td className="td"><form action={setStatus} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={r.id} />
              <select name="status" aria-label={`New status for ${r.name}`} className="input w-36" defaultValue={r.status}>{["trial", "active", "past_due", "suspended", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select>
              <input name="note" required minLength={3} placeholder="Reason / reference" aria-label="Reason" className="input w-48" /><SubmitButton variant="plain">Apply</SubmitButton></form></td></tr>))}
      </Table>
    </main>
  );
}
