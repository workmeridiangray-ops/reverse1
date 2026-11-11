import type { Metadata } from "next";
import { requireCtx } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { code128Svg } from "@/lib/barcode";
import { formatInr } from "@/lib/rules/money";
import { Field, PageHeader } from "@/components/ui/kit";

export const metadata: Metadata = { title: "Print labels" };

/** GET form → printable sheet. kind=item prints item barcodes (barcode, else SKU); kind=lot prints a label per lot/serial in stock. */
export default async function Labels({ searchParams }: { searchParams: Promise<{ kind?: string; item?: string; copies?: string }> }) {
  const q = await searchParams; await requireCtx(); const sb = await createClient();
  const { data: items } = await sb.from("items").select("id,sku,name,barcode,sale_price_paise,tracking").eq("active", true).order("sku");
  const copies = Math.min(Math.max(Number(q.copies) || 1, 1), 100);
  let labels: { code: string; line1: string; line2: string; sub?: string }[] = [];
  if (q.kind === "lot" && q.item) {
    const it = (items ?? []).find((i: any) => i.id === q.item) as any;
    const { data: lots } = await sb.from("lot_stock").select("lot_code,expiry_date,on_hand").eq("item_id", q.item).gt("on_hand", 0);
    labels = (lots ?? []).flatMap((l: any) => Array.from({ length: it?.tracking === "serial" ? 1 : copies }, () => ({ code: l.lot_code, line1: it?.name ?? "", line2: `${it?.tracking === "serial" ? "S/N" : "Lot"} ${l.lot_code}`, sub: l.expiry_date ? `Exp ${l.expiry_date}` : undefined })));
  } else if (q.item) {
    const it = (items ?? []).find((i: any) => i.id === q.item) as any;
    if (it) labels = Array.from({ length: copies }, () => ({ code: it.barcode || it.sku, line1: it.name, line2: it.sku, sub: formatInr(Number(it.sale_price_paise)) }));
  }
  const safe = labels.filter((l) => { try { code128Svg(l.code); return true; } catch { return false; } });
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Print labels" sub="Code 128 barcodes that any USB or Bluetooth scanner reads. Print from the browser (Ctrl+P) on a label sheet or plain paper." />
        <form className="card mb-6 grid gap-4 p-5 sm:grid-cols-4">
          <Field label="Label for" name="kind"><select id="kind" name="kind" defaultValue={q.kind ?? "item"} className="input"><option value="item">Item (barcode or SKU)</option><option value="lot">Each lot / serial in stock</option></select></Field>
          <Field label="Item" name="item"><select id="item" name="item" defaultValue={q.item} required className="input">{(items ?? []).map((i: any) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select></Field>
          <Field label="Copies" name="copies"><input id="copies" name="copies" type="number" min={1} max={100} defaultValue={q.copies ?? "12"} className="input" /></Field>
          <div className="flex items-end"><button className="btn btn-primary">Preview</button></div>
        </form>
        {q.item && labels.length === 0 && <p className="text-muted">Nothing to print for that choice.</p>}
        {labels.length > safe.length && <p role="alert" className="text-danger">Some labels were skipped because their text cannot be encoded.</p>}
        {safe.length > 0 && <p className="mb-2 text-sm text-muted">{safe.length} label(s). Use your browser's print dialog; margins "None", scale 100%.</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:grid-cols-3 print:gap-0" aria-label="Label sheet">
        {safe.map((l, i) => (
          <div key={i} className="break-inside-avoid border border-dashed border-line bg-white p-2 text-center print:border-0" style={{ minHeight: "3.2cm" }}>
            <p className="truncate text-xs font-semibold">{l.line1}</p>
            <div className="mx-auto max-w-full [&_svg]:h-12 [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: code128Svg(l.code, { moduleWidth: 2, height: 60 }) }} />
            <p className="font-mono text-[11px]">{l.line2}</p>{l.sub && <p className="text-[11px]">{l.sub}</p>}
          </div>))}
      </div>
    </>
  );
}
