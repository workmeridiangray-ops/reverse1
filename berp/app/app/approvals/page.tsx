import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Flash, Money, PageHeader, Status, Table } from "@/components/ui/kit";
import { approveApproval, rejectApproval } from "../actions2";

export const metadata: Metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const [{ data }, { data: dels }, { data: mems }] = await Promise.all([
    sb.from("approvals").select("*").order("created_at", { ascending: false }).limit(100),
    sb.from("approval_delegations").select("from_user,to_user,starts_on,ends_on,active").eq("to_user", ctx.userId).eq("active", true),
    sb.from("memberships").select("user_id,role").eq("active", true),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const sat = (have: string, need: string) => have === "owner" || have === need;
  const delegatedFrom = (need: string) => (dels ?? []).find((d: any) => d.starts_on <= today && today <= d.ends_on && sat((mems ?? []).find((m: any) => m.user_id === d.from_user)?.role ?? "", need))?.from_user as string | undefined;
  const rows = data ?? [];
  const ids = (s: string) => rows.filter((r: any) => r.subject === s).map((r: any) => r.subject_id);
  const [{ data: so }, { data: pr }] = await Promise.all([
    sb.from("sales_orders").select("id,number,customers(name)").in("id", ids("sales_order")),
    sb.from("purchase_requests").select("id,number,items(sku)").in("id", ids("purchase_request")),
  ]);
  const label = (r: any) => r.subject === "sales_order" ? (so ?? []).find((x: any) => x.id === r.subject_id) : (pr ?? []).find((x: any) => x.id === r.subject_id);
  const open = (r: any) => r.status === "pending" || r.status === "pending_second";
  const needRole = (r: any) => (r.status === "pending_second" ? r.second_role : r.required_role);
  const mine = (r: any) => {
    if (!open(r)) return false;
    const need = needRole(r); const src = sat(ctx.role, need) ? ctx.userId : delegatedFrom(need);
    if (!src || r.requested_by === ctx.userId || r.requested_by === src) return false;
    return !(r.status === "pending_second" && (r.first_decided_by === ctx.userId || r.first_decided_by === src));
  };
  return (
    <>
      <PageHeader title="Approvals" sub="Requests above your approval thresholds wait here for the named role." />
      <Flash ok={q.ok} error={q.error} />
      {rows.length ? (
        <Table head={["Request", "Record", "Amount", "Needs", "Status", "Decision"]} numeric={[2]}>
          {rows.map((r: any) => { const l: any = label(r); return (
            <tr key={r.id}><td className="td">{r.subject.replace("_", " ")}</td>
              <td className="td">{r.subject === "sales_order" ? <Link className="text-brand underline" href={`/app/sales/${r.subject_id}`}>{l?.number}</Link> : l?.number}{l?.customers?.name && <span className="text-muted"> · {l.customers.name}</span>}{l?.items?.sku && <span className="text-muted"> · {l.items.sku}</span>}</td>
              <td className="td num"><Money paise={Number(r.amount_paise)} /></td><td className="td">{r.required_role}{r.second_role ? ` → ${r.second_role}` : ""}</td><td className="td"><Status value={r.status === "pending_second" ? "pending" : r.status} />{r.status === "pending_second" && <span className="ml-2 text-xs text-muted">step 2 of 2: {r.second_role}</span>}{r.delegated_from && <span className="ml-2 text-xs text-muted">decided as delegate</span>}{r.decision_reason && <span className="ml-2 text-xs text-muted">{r.decision_reason}</span>}</td>
              <td className="td">{mine(r) ? (
                <form className="flex flex-wrap gap-1"><input type="hidden" name="id" value={r.id} /><input name="reason" placeholder="Reason (to reject)" aria-label="Reason" className="input w-40" />
                  <button className="btn btn-primary" formAction={approveApproval}>Approve</button><button className="btn btn-danger" formAction={rejectApproval}>Reject</button></form>
              ) : open(r) && r.requested_by === ctx.userId ? <span className="text-sm text-muted">Waiting for a {needRole(r)}</span> : null}</td></tr>); })}
        </Table>
      ) : <Empty title="No approval requests" hint={can(ctx.role, "owner") ? "Set thresholds under Settings → Approval rules." : "Nothing is waiting."} />}
    </>
  );
}
