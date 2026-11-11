import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Flash, Money, PageHeader, Status, Table } from "@/components/ui/kit";
import { approveApproval, rejectApproval } from "../actions2";

export const metadata: Metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const { data } = await sb.from("approvals").select("*").order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  const ids = (s: string) => rows.filter((r: any) => r.subject === s).map((r: any) => r.subject_id);
  const [{ data: so }, { data: pr }] = await Promise.all([
    sb.from("sales_orders").select("id,number,customers(name)").in("id", ids("sales_order")),
    sb.from("purchase_requests").select("id,number,items(sku)").in("id", ids("purchase_request")),
  ]);
  const label = (r: any) => r.subject === "sales_order" ? (so ?? []).find((x: any) => x.id === r.subject_id) : (pr ?? []).find((x: any) => x.id === r.subject_id);
  const mine = (r: any) => r.status === "pending" && (ctx.role === "owner" || ctx.role === r.required_role) && r.requested_by !== ctx.userId;
  return (
    <>
      <PageHeader title="Approvals" sub="Requests above your approval thresholds wait here for the named role." />
      <Flash ok={q.ok} error={q.error} />
      {rows.length ? (
        <Table head={["Request", "Record", "Amount", "Needs", "Status", "Decision"]} numeric={[2]}>
          {rows.map((r: any) => { const l: any = label(r); return (
            <tr key={r.id}><td className="td">{r.subject.replace("_", " ")}</td>
              <td className="td">{r.subject === "sales_order" ? <Link className="text-brand underline" href={`/app/sales/${r.subject_id}`}>{l?.number}</Link> : l?.number}{l?.customers?.name && <span className="text-muted"> · {l.customers.name}</span>}{l?.items?.sku && <span className="text-muted"> · {l.items.sku}</span>}</td>
              <td className="td num"><Money paise={Number(r.amount_paise)} /></td><td className="td">{r.required_role}</td><td className="td"><Status value={r.status} />{r.decision_reason && <span className="ml-2 text-xs text-muted">{r.decision_reason}</span>}</td>
              <td className="td">{mine(r) ? (
                <form className="flex flex-wrap gap-1"><input type="hidden" name="id" value={r.id} /><input name="reason" placeholder="Reason (to reject)" aria-label="Reason" className="input w-40" />
                  <button className="btn btn-primary" formAction={approveApproval}>Approve</button><button className="btn btn-danger" formAction={rejectApproval}>Reject</button></form>
              ) : r.status === "pending" && r.requested_by === ctx.userId ? <span className="text-sm text-muted">Waiting for a {r.required_role}</span> : null}</td></tr>); })}
        </Table>
      ) : <Empty title="No approval requests" hint={can(ctx.role, "owner") ? "Set thresholds under Settings → Approval rules." : "Nothing is waiting."} />}
    </>
  );
}
