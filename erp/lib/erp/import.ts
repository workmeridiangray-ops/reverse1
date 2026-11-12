import type { Db } from "../db";
import type { TCtx } from "../actions";
import { parseCsv } from "../csv";
import { parseMoney, parseQty } from "../money";
import { openingStock } from "./stock";

export const TEMPLATES: Record<string, { header: string[]; example: string[] }> = {
  customers: { header: ["code", "name", "email", "phone", "gstin", "credit_limit", "payment_terms_days"], example: ["ACME", "Acme Traders", "buy@acme.example", "9876543210", "", "100000", "30"] },
  suppliers: { header: ["code", "name", "email", "phone", "gstin", "lead_time_days"], example: ["SUP1", "Parts Co", "sales@parts.example", "", "", "7"] },
  items: { header: ["sku", "name", "kind", "base_unit", "sale_price", "purchase_price", "tax_code", "barcode"], example: ["WID-1", "Widget", "goods", "pcs", "100.00", "60.00", "GST18", "8901234567890"] },
  opening_stock: { header: ["sku", "warehouse_code", "quantity", "unit_cost"], example: ["WID-1", "WH-MAIN", "50", "60.00"] },
};
export interface RowResult { line: number; ok: boolean; error?: string }

/** Validates every row first; with commit=true it applies only if ALL rows are valid (all-or-nothing). */
export async function runImport(db: Db, ctx: TCtx, kind: string, text: string, commit: boolean): Promise<{ results: RowResult[]; applied: boolean }> {
  const t = TEMPLATES[kind]; if (!t) throw new Error("Unknown import type");
  const rows = parseCsv(text); const results: RowResult[] = [];
  if (!rows.length) return { results: [{ line: 1, ok: false, error: "The file is empty." }], applied: false };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const miss = t.header.filter((h) => !head.includes(h));
  if (miss.length) return { results: [{ line: 1, ok: false, error: `Missing column(s): ${miss.join(", ")}. Download the template.` }], applied: false };
  if (rows.length > 5001) return { results: [{ line: 1, ok: false, error: "Maximum 5,000 rows per file." }], applied: false };
  const g = (r: string[], k: string) => (r[head.indexOf(k)] ?? "").trim();
  const seen = new Set<string>();
  const ops: Array<() => Promise<void>> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], line = i + 1;
    try {
      const key = g(r, kind === "opening_stock" ? "sku" : head[0]) + "|" + (kind === "opening_stock" ? g(r, "warehouse_code") : "");
      if (!g(r, head[0]) && kind !== "opening_stock") throw new Error("code is required");
      if (seen.has(key)) throw new Error("duplicate row in file"); seen.add(key);
      if (kind === "customers") {
        if (!g(r, "name")) throw new Error("name is required");
        const limit = g(r, "credit_limit") ? parseMoney(g(r, "credit_limit"), "credit_limit") : 0;
        if ((await db.query("select 1 from customers where tenant_id=$1 and code=$2", [ctx.tenant.id, g(r, "code")])).rowCount) throw new Error("code already exists");
        ops.push(async () => { await db.query("insert into customers(tenant_id,code,name,email,phone,gstin,credit_limit_paise,payment_terms_days) values ($1,$2,$3,$4,$5,$6,$7,$8)", [ctx.tenant.id, g(r, "code"), g(r, "name"), g(r, "email") || null, g(r, "phone") || null, g(r, "gstin") || null, limit, Number(g(r, "payment_terms_days")) || 30]); });
      } else if (kind === "suppliers") {
        if (!g(r, "name")) throw new Error("name is required");
        if ((await db.query("select 1 from suppliers where tenant_id=$1 and code=$2", [ctx.tenant.id, g(r, "code")])).rowCount) throw new Error("code already exists");
        ops.push(async () => { await db.query("insert into suppliers(tenant_id,code,name,email,phone,gstin,lead_time_days) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.tenant.id, g(r, "code"), g(r, "name"), g(r, "email") || null, g(r, "phone") || null, g(r, "gstin") || null, Number(g(r, "lead_time_days")) || 7]); });
      } else if (kind === "items") {
        if (!g(r, "name")) throw new Error("name is required");
        const k = g(r, "kind") || "goods"; if (!["goods", "service"].includes(k)) throw new Error("kind must be goods or service");
        const sp = g(r, "sale_price") ? parseMoney(g(r, "sale_price"), "sale_price") : 0, pp = g(r, "purchase_price") ? parseMoney(g(r, "purchase_price"), "purchase_price") : 0;
        const tc = g(r, "tax_code") ? (await db.query("select id from tax_codes where tenant_id=$1 and code=$2", [ctx.tenant.id, g(r, "tax_code")])).rows[0] : null; if (g(r, "tax_code") && !tc) throw new Error(`unknown tax_code ${g(r, "tax_code")}`);
        if ((await db.query("select 1 from items where tenant_id=$1 and sku=$2", [ctx.tenant.id, g(r, "sku")])).rowCount) throw new Error("sku already exists");
        ops.push(async () => { await db.query("insert into items(tenant_id,sku,name,kind,base_unit,sale_price_paise,purchase_price_paise,tax_code_id,barcode) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [ctx.tenant.id, g(r, "sku"), g(r, "name"), k, g(r, "base_unit") || "pcs", sp, pp, tc?.id ?? null, g(r, "barcode") || null]); });
      } else {
        const it = (await db.query("select id, kind from items where tenant_id=$1 and sku=$2", [ctx.tenant.id, g(r, "sku")])).rows[0]; if (!it) throw new Error(`unknown sku ${g(r, "sku")}`); if (it.kind !== "goods") throw new Error("services have no stock");
        const wh = (await db.query("select id from warehouses where tenant_id=$1 and code=$2", [ctx.tenant.id, g(r, "warehouse_code")])).rows[0]; if (!wh) throw new Error(`unknown warehouse ${g(r, "warehouse_code")}`);
        const q = parseQty(g(r, "quantity")), c = parseMoney(g(r, "unit_cost"), "unit_cost");
        ops.push(async () => { await openingStock(db, ctx, { itemId: it.id, warehouseId: wh.id, qty: q, unitCost: c }); });
      }
      results.push({ line, ok: true });
    } catch (e: any) { results.push({ line, ok: false, error: e.message }); }
  }
  const failed = results.filter((r) => !r.ok).length;
  let applied = false;
  if (commit && failed === 0) { for (const op of ops) await op(); applied = true; }
  return { results, applied };
}
