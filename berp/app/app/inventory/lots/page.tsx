import type { Metadata } from "next";
import { requireCtx } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Flash, PageHeader, Qty, Table } from "@/components/ui/kit";

export const metadata: Metadata = { title: "Lots & serials" };
const TONE: Record<string, string> = { expired: "bg-danger-bg text-danger", expiring: "bg-warn-bg text-warn", ok: "bg-ok-bg text-ok", "no expiry": "bg-neutral-bg text-neutral" };

export default async function Lots({ searchParams }: { searchParams: Promise<{ q?: string; item?: string; lot?: string; error?: string }> }) {
  const q = await searchParams; await requireCtx(); const sb = await createClient();
  let query = sb.from("lot_stock").select("*").order("expiry_date", { ascending: true, nullsFirst: false }).limit(300);
  if (q.q) query = query.or(`lot_code.ilike.%${q.q.replace(/[%_,()]/g, "")}%,sku.ilike.%${q.q.replace(/[%_,()]/g, "")}%`);
  const { data: lots } = await query;
  const safeQ = (q.q ?? "").replace(/[%_,()]/g, "");
  const { data: found } = safeQ ? await sb.from("stock_lots").select("id,lot_code,expiry_date,item_id,items(sku,name)").ilike("lot_code", `%${safeQ}%`).order("lot_code").limit(50) : { data: [] as any[] };
  const trace = q.item && q.lot ? (await sb.rpc("trace_lot", { p_item: q.item, p_code: q.lot })).data as any[] | null : null;
  return (
    <>
      <PageHeader title="Lots & serials" sub="Stock by lot, with expiry. Open a lot to see every receipt, shipment and return for recalls and warranty." />
      <Flash error={q.error} />
      <form className="mb-4 flex gap-2" role="search"><input className="input max-w-xs" name="q" defaultValue={q.q} placeholder="Search lot, serial or SKU" aria-label="Search lots" /><button className="btn">Search</button></form>
      {lots?.length ? (
        <Table head={["SKU", "Item", "Lot / serial", "Warehouse", "Expiry", "Status", "On hand", ""]} numeric={[6]}>
          {lots.map((l: any) => <tr key={`${l.lot_id}${l.warehouse_id}`}><td className="td font-mono">{l.sku}</td><td className="td">{l.item_name}</td><td className="td font-mono">{l.lot_code}</td><td className="td">{l.warehouse_name}</td>
            <td className="td">{l.expiry_date ?? "—"}{l.days_to_expiry != null && <span className="text-xs text-muted"> ({l.days_to_expiry}d)</span>}</td>
            <td className="td"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[l.expiry_status]}`}>{l.expiry_status}</span></td><td className="td num"><Qty v={l.on_hand} /></td>
            <td className="td"><a className="text-brand underline" href={`/app/inventory/lots?item=${l.item_id}&lot=${encodeURIComponent(l.lot_code)}`}>Trace</a></td></tr>)}
        </Table>
      ) : <Empty title="No lot-tracked stock" hint="Mark an item as batch or serial tracked, then receive it with lot numbers." />}
      {safeQ && (<><h2 className="mb-2 mt-8 font-semibold">Lots matching “{safeQ}” (including sold out)</h2>
        <Table head={["SKU", "Lot / serial", "Expiry", ""]}>{(found ?? []).map((l: any) => <tr key={l.id}><td className="td font-mono">{l.items?.sku}</td><td className="td font-mono">{l.lot_code}</td><td className="td">{l.expiry_date ?? "—"}</td><td className="td"><a className="text-brand underline" href={`/app/inventory/lots?item=${l.item_id}&lot=${encodeURIComponent(l.lot_code)}`}>Trace</a></td></tr>)}
          {!found?.length && <tr><td className="td text-muted" colSpan={4}>No lot or serial with that number.</td></tr>}</Table></>)}
      {trace && (<><h2 className="mb-2 mt-8 font-semibold">History of {q.lot}</h2>
        <Table head={["When", "Event", "Document", "Qty", "Party / note", "Warehouse"]} numeric={[3]}>{trace.map((t, i) => <tr key={i}><td className="td">{String(t.at).slice(0, 16).replace("T", " ")}</td><td className="td">{String(t.event).replace("_", " ")}</td><td className="td font-mono">{t.document}</td><td className="td num"><Qty v={t.qty} /></td><td className="td">{t.party ?? "—"}</td><td className="td">{t.warehouse}</td></tr>)}
          {!trace.length && <tr><td className="td text-muted" colSpan={6}>Nothing found for that lot.</td></tr>}</Table></>)}
    </>
  );
}
