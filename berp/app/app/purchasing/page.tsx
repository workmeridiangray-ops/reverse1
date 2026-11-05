import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Flash, PageHeader, Qty, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { approveRequest, rejectRequest } from "../actions";

export const metadata: Metadata = { title: "Purchasing" };

export default async function Purchasing({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const [{ data: prs }, { data: pos }, { data: sups }] = await Promise.all([
    sb.from("purchase_requests").select("*, items(sku,name,unit,cost_paise), warehouses(name)").order("created_at", { ascending: false }).limit(50),
    sb.from("purchase_orders").select("id,number,status,created_at,suppliers(name)").order("created_at", { ascending: false }).limit(50),
    sb.from("suppliers").select("id,name").eq("active", true).order("name"),
  ]);
  const approver = can(ctx.role, "owner", "manager", "purchasing");
  return (
    <>
      <PageHeader title="Purchasing" sub="Request → approval → order → receipt → bill matching." />
      <Flash ok={q.ok} error={q.error} />
      <h2 className="mb-2 font-semibold">Purchase requests</h2>
      {prs?.length ? (
        <Table head={["Request", "Item", "Qty", "Warehouse", "Status", "Decision"]} numeric={[2]}>
          {prs.map((r: any) => (
            <tr key={r.id}><td className="td font-mono">{r.number}</td><td className="td">{r.items?.sku} · {r.items?.name}</td><td className="td num"><Qty v={r.qty} /> {r.items?.unit}</td><td className="td">{r.warehouses?.name}</td><td className="td"><Status value={r.status} /></td>
              <td className="td">{r.status === "pending" && approver ? (
                <div className="space-y-2">
                  <form action={approveRequest} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={r.id} />
                    <label className="text-xs">Supplier<select name="supplier" required className="input mt-1">{(sups ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                    <label className="text-xs">Unit cost (₹)<input name="cost" required inputMode="decimal" defaultValue={((r.items?.cost_paise ?? 0) / 100).toFixed(2)} className="input mt-1 w-28" /></label>
                    <SubmitButton>Approve</SubmitButton></form>
                  <form action={rejectRequest} className="flex items-end gap-2"><input type="hidden" name="id" value={r.id} /><input name="reason" required minLength={3} placeholder="Reason to reject" aria-label="Rejection reason" className="input" /><SubmitButton variant="danger">Reject</SubmitButton></form>
                </div>) : r.decision_reason ?? ""}</td></tr>
          ))}
        </Table>
      ) : <Empty title="No purchase requests" hint="They appear when a confirmed order is short of stock." />}
      <h2 className="mb-2 mt-8 font-semibold">Purchase orders</h2>
      {pos?.length ? (
        <Table head={["Order", "Supplier", "Created", "Status"]}>
          {pos.map((p: any) => <tr key={p.id}><td className="td"><Link className="font-medium text-brand underline" href={`/app/purchasing/${p.id}`}>{p.number}</Link></td><td className="td">{p.suppliers?.name}</td><td className="td">{String(p.created_at).slice(0, 10)}</td><td className="td"><Status value={p.status} /></td></tr>)}
        </Table>
      ) : <Empty title="No purchase orders yet" />}
    </>
  );
}
