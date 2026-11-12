"use client";
import { useMemo, useState } from "react";
import { lineAmounts, formatMoney } from "@/lib/money";

export interface ItemOpt { id: string; label: string; unit: string; price: number; taxBps: number; uoms: { unit: string; factor: number }[]; kind: string }
interface Row { itemId: string; qty: string; uom: string; price: string; disc: string }
const blank = (): Row => ({ itemId: "", qty: "", uom: "", price: "", disc: "" });

/** Keyboard-friendly line entry. Totals shown here are a preview; the server recalculates and is authoritative. */
export function LineGrid({ items, mode, initial, showPrice = true, showDiscount = true, name = "lines" }: {
  items: ItemOpt[]; mode: "sale" | "purchase" | "qty"; initial?: Row[]; showPrice?: boolean; showDiscount?: boolean; name?: string;
}) {
  const [rows, setRows] = useState<Row[]>(initial?.length ? initial : [blank()]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const preview = (r: Row) => {
    const it = byId.get(r.itemId); if (!it || !/^\d+(\.\d{1,3})?$/.test(r.qty)) return null;
    const f = r.uom && r.uom !== it.unit ? it.uoms.find((u) => u.unit === r.uom)?.factor ?? 1000 : 1000;
    const qtyBase = Math.round((Number(r.qty) * f));
    const priceStr = r.price !== "" ? r.price : String((mode === "sale" ? it.price : it.price) / 100);
    if (!/^\d+(\.\d{1,2})?$/.test(priceStr)) return null;
    const price = Math.round(Number(priceStr) * 100);
    const d = r.disc ? Math.round(Number(r.disc) * 100) : 0;
    return lineAmounts(qtyBase, price, d, it.taxBps, f).total;
  };
  const total = rows.reduce((s, r) => s + (preview(r) ?? 0), 0);
  return (
    <div>
      <div className="tablewrap">
        <table className="linegrid" aria-label="Line items">
          <thead><tr><th>Item</th><th className="num">Qty</th><th>Unit</th>{showPrice && <th className="num">Price</th>}{showDiscount && mode === "sale" && <th className="num">Disc %</th>}{showPrice && <th className="num">Line total</th>}<th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const it = byId.get(r.itemId);
              return (
                <tr key={i}>
                  <td style={{ minWidth: 220 }}>
                    <select aria-label={`Line ${i + 1} item`} name={`${name}[${i}][itemId]`} value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value, uom: "", price: "" })}>
                      <option value="">Select item…</option>
                      {items.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={{ width: 110 }}><input aria-label={`Line ${i + 1} quantity`} name={`${name}[${i}][qty]`} inputMode="decimal" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && i === rows.length - 1 && !showPrice) { e.preventDefault(); setRows([...rows, blank()]); } }} placeholder="0" /></td>
                  <td style={{ width: 110 }}>
                    <select aria-label={`Line ${i + 1} unit`} name={`${name}[${i}][uom]`} value={r.uom} onChange={(e) => set(i, { uom: e.target.value, price: "" })}>
                      <option value="">{it?.unit ?? "unit"}</option>
                      {it?.uoms.map((u) => <option key={u.unit} value={u.unit}>{u.unit} (×{u.factor / 1000})</option>)}
                    </select>
                  </td>
                  {showPrice && <td style={{ width: 130 }}><input aria-label={`Line ${i + 1} price`} name={`${name}[${i}][price]`} inputMode="decimal" value={r.price} onChange={(e) => set(i, { price: e.target.value })}
                    placeholder={it ? (it.price / 100).toFixed(2) : "list price"}
                    onKeyDown={(e) => { if (e.key === "Enter" && i === rows.length - 1 && !(showDiscount && mode === "sale")) { e.preventDefault(); setRows([...rows, blank()]); } }} /></td>}
                  {showDiscount && mode === "sale" && <td style={{ width: 90 }}><input aria-label={`Line ${i + 1} discount percent`} name={`${name}[${i}][discountPct]`} inputMode="decimal" value={r.disc} onChange={(e) => set(i, { disc: e.target.value })} placeholder="0"
                    onKeyDown={(e) => { if (e.key === "Enter" && i === rows.length - 1) { e.preventDefault(); setRows([...rows, blank()]); } }} /></td>}
                  {showPrice && <td className="num" style={{ width: 130 }}>{preview(r) !== null ? formatMoney(preview(r)) : "—"}</td>}
                  <td style={{ width: 60 }}><button type="button" className="btn sm ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [blank()])}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
          {showPrice && <tfoot><tr><td colSpan={showDiscount && mode === "sale" ? 5 : 4} className="right">Estimated total incl. tax</td><td className="num">{formatMoney(total)}</td><td /></tr></tfoot>}
        </table>
      </div>
      <button type="button" className="btn sm" onClick={() => setRows([...rows, blank()])}>+ Add line</button>
      <span className="hint"> Tip: press Enter in the last field to add a line. Final amounts are calculated on save.</span>
    </div>
  );
}
