import type { Db } from "../db";
import { UserError } from "../errors";
import { parseMoney, parseQty, lineAmounts } from "../money";

export interface RawLine { itemId: string; qty: string; uom?: string; price?: string; discountPct?: string }
export interface ResolvedLine {
  itemId: string; itemName: string; kind: string; qtyBase: number; uomQty: number; uom: string; factorMilli: number;
  pricePerUom: number; discountBps: number; taxBps: number; net: number; tax: number; total: number;
}

/** Reads items[0][itemId] style fields posted by the line grid. */
export function readLines(form: FormData, prefix = "lines"): RawLine[] {
  const rows = new Map<number, any>();
  for (const [k, v] of form.entries()) {
    const m = k.match(new RegExp(`^${prefix}\\[(\\d+)\\]\\[(\\w+)\\]$`));
    if (m && typeof v === "string") { const i = Number(m[1]); rows.set(i, { ...(rows.get(i) ?? {}), [m[2]]: v.trim() }); }
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r).filter((r) => r.itemId || r.qty);
}

export async function resolveLines(db: Db, tenantId: string, raw: RawLine[], opts: { kind: "sale" | "purchase"; customerId?: string; maxLines?: number }): Promise<ResolvedLine[]> {
  if (!raw.length) throw new UserError("Add at least one line.");
  if (raw.length > (opts.maxLines ?? 200)) throw new UserError("Too many lines on one document.");
  const out: ResolvedLine[] = [];
  const seen = new Set<string>();
  for (const [i, r] of raw.entries()) {
    const f = (m: string) => ({ [`line${i}`]: m });
    if (!r.itemId) throw new UserError(`Line ${i + 1}: choose an item.`, f("Choose an item"));
    const item = (await db.query(
      `select i.*, coalesce(t.rate_bps,0) rate_bps from items i left join tax_codes t on t.id=i.tax_code_id and t.tenant_id=i.tenant_id where i.id=$1 and i.tenant_id=$2`, [r.itemId, tenantId])).rows[0];
    if (!item) throw new UserError(`Line ${i + 1}: item not found.`);
    if (item.status !== "active") throw new UserError(`Line ${i + 1}: ${item.name} is retired and cannot be used on new documents.`);
    if (seen.has(item.id) && opts.kind === "purchase") throw new UserError(`Line ${i + 1}: ${item.name} appears twice; combine the quantities.`);
    seen.add(item.id);
    let uomQty: number;
    try { uomQty = parseQty(r.qty, `Line ${i + 1} quantity`); } catch (e: any) { throw new UserError(e.message, f(e.message)); }
    const uom = r.uom || item.base_unit;
    let factor = 1000;
    if (uom !== item.base_unit) {
      const u = (await db.query("select factor_milli from item_uoms where tenant_id=$1 and item_id=$2 and unit=$3", [tenantId, item.id, uom])).rows[0];
      if (!u) throw new UserError(`Line ${i + 1}: ${item.name} has no conversion for unit "${uom}".`);
      factor = Number(u.factor_milli);
    }
    const qtyBase = Math.round((uomQty * factor) / 1000);
    if (qtyBase <= 0) throw new UserError(`Line ${i + 1}: quantity is too small for the base unit.`);
    let price: number;
    if (r.price !== undefined && r.price !== "") {
      try { price = parseMoney(r.price, `Line ${i + 1} price`); } catch (e: any) { throw new UserError(e.message); }
    } else if (opts.kind === "sale") {
      let base = item.sale_price_paise;
      if (opts.customerId) {
        const pl = (await db.query(
          `select pli.price_paise from customers c join price_list_items pli on pli.price_list_id=c.price_list_id and pli.tenant_id=c.tenant_id
            where c.id=$1 and c.tenant_id=$2 and pli.item_id=$3`, [opts.customerId, tenantId, item.id])).rows[0];
        if (pl) base = pl.price_paise;
      }
      price = Math.round((base * factor) / 1000);
    } else price = Math.round((item.purchase_price_paise * factor) / 1000);
    const disc = r.discountPct ? Math.round(Number(r.discountPct) * 100) : 0;
    if (!Number.isFinite(disc) || disc < 0 || disc > 10000) throw new UserError(`Line ${i + 1}: discount must be between 0 and 100%.`);
    const a = lineAmounts(qtyBase, price, disc, item.rate_bps, factor);
    out.push({ itemId: item.id, itemName: item.name, kind: item.kind, qtyBase, uomQty, uom, factorMilli: factor, pricePerUom: price, discountBps: disc, taxBps: item.rate_bps, ...a });
  }
  return out;
}
export const sumLines = (ls: { net: number; tax: number; total: number }[]) => ({
  subtotal: ls.reduce((s, l) => s + l.net, 0), tax: ls.reduce((s, l) => s + l.tax, 0), total: ls.reduce((s, l) => s + l.total, 0),
});
