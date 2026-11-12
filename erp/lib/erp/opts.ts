import type { Db } from "../db";
import type { ItemOpt } from "@/components/LineGrid";

export async function itemOptions(db: Db, tenantId: string, kind: "sale" | "purchase", goodsOnly = false): Promise<ItemOpt[]> {
  const items = (await db.query(
    `select i.id, i.sku, i.name, i.base_unit, i.kind, i.sale_price_paise, i.purchase_price_paise, coalesce(t.rate_bps,0) rate from items i left join tax_codes t on t.id=i.tax_code_id and t.tenant_id=i.tenant_id
      where i.tenant_id=$1 and i.status='active' ${goodsOnly ? "and i.kind='goods'" : ""} order by i.sku limit 1000`, [tenantId])).rows;
  const uoms = (await db.query("select item_id, unit, factor_milli from item_uoms where tenant_id=$1", [tenantId])).rows;
  return items.map((i: any) => ({ id: i.id, label: `${i.sku} — ${i.name}`, unit: i.base_unit, price: kind === "sale" ? i.sale_price_paise : i.purchase_price_paise, taxBps: i.rate, kind: i.kind,
    uoms: uoms.filter((u: any) => u.item_id === i.id).map((u: any) => ({ unit: u.unit, factor: Number(u.factor_milli) })) }));
}
export const branchesFor = async (db: Db, tenantId: string, scope: string[] | null) =>
  (await db.query("select id, name from branches where tenant_id=$1 and status='active' and ($2::uuid[] is null or id = any($2)) order by name", [tenantId, scope])).rows as { id: string; name: string }[];
export const warehousesFor = async (db: Db, tenantId: string, scope: string[] | null) =>
  (await db.query("select id, name, branch_id from warehouses where tenant_id=$1 and status='active' and ($2::uuid[] is null or branch_id = any($2)) order by name", [tenantId, scope])).rows as { id: string; name: string; branch_id: string }[];
export const customersList = async (db: Db, tenantId: string) =>
  (await db.query("select id, code||' — '||name name from customers where tenant_id=$1 and status='active' order by name limit 1000", [tenantId])).rows as { id: string; name: string }[];
export const suppliersList = async (db: Db, tenantId: string) =>
  (await db.query("select id, code||' — '||name name from suppliers where tenant_id=$1 and status='active' order by name limit 1000", [tenantId])).rows as { id: string; name: string }[];
