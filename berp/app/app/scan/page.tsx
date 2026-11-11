import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Flash, PageHeader, Qty, Table } from "@/components/ui/kit";

export const metadata: Metadata = { title: "Scan" };

/** A USB/Bluetooth scanner types the code and presses Enter, so a plain autofocused form is the whole "scan" integration. */
export default async function Scan({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const q = await searchParams; await requireCtx(); const sb = await createClient();
  const code = (q.code ?? "").trim().slice(0, 80);
  let item: any = null, lot: any = null;
  if (code) {
    const cols = "id,sku,name,barcode,unit,tracking,sale_price_paise";
    item = (await sb.from("items").select(cols).eq("barcode", code).limit(1)).data?.[0] ?? (await sb.from("items").select(cols).eq("sku", code).limit(1)).data?.[0] ?? null;
    if (!item) {
      const l = await sb.from("stock_lots").select("id,lot_code,expiry_date,item_id, items(id,sku,name,unit,tracking)").eq("lot_code", code).limit(1);
      if (l.data?.[0]) { lot = l.data[0]; item = (lot as any).items; }
    }
  }
  const { data: levels } = item ? await sb.from("stock_levels").select("warehouse_name,on_hand,reserved").eq("item_id", item.id) : { data: [] as any[] };
  const { data: lotRows } = lot ? await sb.from("lot_stock").select("warehouse_name,on_hand,expiry_status").eq("lot_id", lot.id) : { data: [] as any[] };
  return (
    <>
      <PageHeader title="Scan" sub="Click the box and scan an item barcode, SKU, lot or serial number." />
      <form className="card mb-6 flex gap-2 p-4" role="search"><label className="sr-only" htmlFor="code">Scan or type a code</label><input id="code" name="code" autoFocus autoComplete="off" defaultValue={code} className="input text-lg" placeholder="Scan…" /><button className="btn btn-primary">Look up</button></form>
      {code && !item && <Flash error={`Nothing found for "${code}". Check the barcode on the item master, or the lot/serial spelling.`} />}
      {item && (
        <div className="card space-y-3 p-5">
          <p className="text-lg font-semibold">{item.sku} · {item.name}</p>
          {lot && <p className="text-sm">Lot/serial <span className="font-mono">{lot.lot_code}</span>{lot.expiry_date ? ` · expires ${lot.expiry_date}` : ""} · <Link className="text-brand underline" href={`/app/inventory/lots?item=${item.id}&lot=${encodeURIComponent(lot.lot_code)}`}>full history</Link></p>}
          <Table head={lot ? ["Warehouse", "On hand", "Expiry status"] : ["Warehouse", "On hand", "Reserved", "Available"]} numeric={lot ? [1] : [1, 2, 3]}>
            {lot ? (lotRows ?? []).map((r: any, i: number) => <tr key={i}><td className="td">{r.warehouse_name}</td><td className="td num"><Qty v={r.on_hand} /></td><td className="td">{r.expiry_status}</td></tr>)
              : (levels ?? []).map((r: any, i: number) => <tr key={i}><td className="td">{r.warehouse_name}</td><td className="td num"><Qty v={r.on_hand} /></td><td className="td num"><Qty v={r.reserved} /></td><td className="td num"><Qty v={Number(r.on_hand) - Number(r.reserved)} /></td></tr>)}
          </Table>
        </div>)}
    </>
  );
}
