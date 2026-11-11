import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Flash, Money, PageHeader, Qty, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { receiveGoods, postBill, payBill } from "../../actions";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PO({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params; const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const { data: po } = await sb.from("purchase_orders").select("*, suppliers(name), warehouses(name)").eq("id", id).maybeSingle();
  if (!po) notFound();
  const [{ data: lines }, { data: grns }] = await Promise.all([
    sb.from("purchase_order_lines").select("*, items(sku,name,unit,tracking)").eq("po_id", id),
    sb.from("goods_receipts").select("id,number,created_at").eq("po_id", id).order("created_at"),
  ]);
  const finOk = can(ctx.role, "owner", "manager", "accountant", "viewer");
  const { data: bills } = finOk ? await sb.from("supplier_bills").select("*").eq("po_id", id) : { data: [] as any[] };
  const canReceive = can(ctx.role, "owner", "manager", "warehouse", "purchasing") && !["billed", "cancelled", "received"].includes(po.status);
  const received = (lines ?? []).reduce((a: number, l: any) => a + Math.round(Number(l.qty_received) * Number(l.unit_cost_paise)), 0);
  const key = `${id}:${(grns ?? []).length}`;
  return (
    <>
      <PageHeader title={po.number} sub={`${po.suppliers?.name} → ${po.warehouses?.name}`} actions={<Status value={po.status} />} />
      <Flash ok={q.ok} error={q.error} />
      <Table head={["Item", "Ordered", "Received", "Billed", "Unit cost", "Tax"]} numeric={[1, 2, 3, 4, 5]}>
        {(lines ?? []).map((l: any) => <tr key={l.id}><td className="td">{l.items?.sku} · {l.items?.name}</td><td className="td num"><Qty v={l.qty} /></td><td className="td num"><Qty v={l.qty_received} /></td><td className="td num"><Qty v={l.qty_billed} /></td><td className="td num"><Money paise={Number(l.unit_cost_paise)} /></td><td className="td num">{l.tax_rate_bp / 100}%</td></tr>)}
      </Table>
      {!!grns?.length && <p className="mt-3 text-sm text-muted">Receipts: {grns.map((g: any) => g.number).join(", ")}</p>}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {canReceive && (
          <form action={receiveGoods} className="card space-y-3 p-5"><input type="hidden" name="id" value={id} /><input type="hidden" name="key" value={key} />
            <h2 className="font-semibold">Receive goods</h2><p className="text-sm text-muted">Partial receipts are fine. Receiving more than ordered is blocked. Stock waiting on orders is reserved automatically.</p>
            {(lines ?? []).filter((l: any) => Number(l.qty_received) < Number(l.qty)).map((l: any) => l.items?.tracking && l.items.tracking !== "none" ? (
              <label key={l.id} className="block text-sm"><span className="font-medium">{l.items?.sku} · open <Qty v={Number(l.qty) - Number(l.qty_received)} /> · {l.items.tracking === "batch" ? "one lot per line: LOT, qty, expiry (optional)" : "one serial per line (add , expiry if it has one)"}</span>
                <textarea name={`lots_${l.id}`} rows={3} className="input mt-1 py-2 font-mono text-xs" placeholder={l.items.tracking === "batch" ? "B-2026-11, 40, 2027-11-30" : "SN-0001\nSN-0002"} aria-label={`Lots received for ${l.items?.sku}`} /></label>
            ) : (
              <label key={l.id} className="flex items-center justify-between gap-3 text-sm"><span>{l.items?.sku} · open <Qty v={Number(l.qty) - Number(l.qty_received)} /></span><input className="input w-28" name={`r_${l.id}`} inputMode="decimal" placeholder="Qty" aria-label={`Received quantity for ${l.items?.sku}`} /></label>))}
            <SubmitButton>Post receipt</SubmitButton></form>
        )}
        {can(ctx.role, "owner", "manager", "accountant", "purchasing") && received > 0 && !bills?.length && (
          <form action={postBill} className="card space-y-3 p-5"><input type="hidden" name="id" value={id} /><h2 className="font-semibold">Supplier bill (three-way match)</h2>
            <p className="text-sm text-muted">Received value at order cost: <Money paise={received} />. Bills outside the tolerance need a manager and a reason.</p>
            <label className="block text-sm font-medium" htmlFor="ref">Supplier invoice no.</label><input id="ref" name="ref" required className="input" />
            <label className="block text-sm font-medium" htmlFor="subtotal">Billed subtotal before tax (₹)</label><input id="subtotal" name="subtotal" required inputMode="decimal" className="input" />
            <label className="block text-sm font-medium" htmlFor="reason">Exception reason (only if outside tolerance)</label><input id="reason" name="reason" className="input" />
            <SubmitButton>Post bill</SubmitButton></form>
        )}
        {(bills ?? []).map((b: any) => (
          <div key={b.id} className="card space-y-2 p-5"><h2 className="font-semibold">{b.number} · {b.supplier_ref}</h2>
            <p className="text-sm">Total <Money paise={Number(b.total_paise)} /> · paid <Money paise={Number(b.paid_paise)} /></p>
            {b.exception_reason && <p className="text-sm text-warn">Exception: {b.exception_reason}</p>}
            {can(ctx.role, "owner", "accountant") && Number(b.paid_paise) < Number(b.total_paise) && (
              <form action={payBill} className="flex items-end gap-2"><input type="hidden" name="po" value={id} /><input type="hidden" name="bill" value={b.id} />
                <label className="text-sm">Pay (₹)<input name="amount" required inputMode="decimal" className="input mt-1" /></label><SubmitButton>Record payment</SubmitButton></form>)}
          </div>))}
      </div>
    </>
  );
}
