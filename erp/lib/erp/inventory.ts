import type { Db } from "../db";
import { UserError } from "../errors";

export interface Move {
  tenantId: string; userId: string; itemId: string; warehouseId: string; delta: number;
  kind: "opening" | "receipt" | "dispatch" | "transfer_out" | "transfer_in" | "adjustment" | "return_in" | "supplier_return" | "reversal";
  unitCost: number; docType: string; docId: string; docLineId?: string | null; consumeReserved?: boolean; note?: string; reversesId?: number | null;
}

async function lockBalance(db: Db, tenantId: string, itemId: string, wh: string) {
  await db.query("insert into stock_balances(tenant_id,item_id,warehouse_id) values ($1,$2,$3) on conflict do nothing", [tenantId, itemId, wh]);
  return (await db.query("select * from stock_balances where tenant_id=$1 and item_id=$2 and warehouse_id=$3 for update", [tenantId, itemId, wh])).rows[0];
}

/** The only writer of stock. Locks the balance row, appends an immutable movement, updates the cached balance. */
export async function moveStock(db: Db, m: Move): Promise<number> {
  const item = (await db.query("select kind, name from items where id=$1 and tenant_id=$2", [m.itemId, m.tenantId])).rows[0];
  if (!item) throw new UserError("Item not found");
  if (item.kind !== "goods") throw new UserError(`${item.name} is a service and has no stock`);
  const b = await lockBalance(db, m.tenantId, m.itemId, m.warehouseId);
  const newOnHand = b.on_hand + m.delta;
  const newReserved = b.reserved - (m.consumeReserved ? Math.abs(m.delta) : 0);
  if (newOnHand < 0) throw new UserError(`Not enough stock of ${item.name}: ${b.on_hand / 1000} on hand, ${Math.abs(m.delta) / 1000} needed.`);
  if (newReserved < 0) throw new UserError(`Reservation mismatch for ${item.name}`);
  if (newOnHand < newReserved) throw new UserError(`${item.name}: the remaining stock is promised to other orders (${newReserved / 1000} reserved). Free reservations first.`);
  const mv = (await db.query(
    `insert into stock_movements(tenant_id,item_id,warehouse_id,qty_delta,kind,unit_cost_paise,doc_type,doc_id,doc_line_id,reverses_id,note,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [m.tenantId, m.itemId, m.warehouseId, m.delta, m.kind, m.unitCost, m.docType, m.docId, m.docLineId ?? null, m.reversesId ?? null, m.note ?? null, m.userId])).rows[0].id;
  await db.query("update stock_balances set on_hand=$4, reserved=$5 where tenant_id=$1 and item_id=$2 and warehouse_id=$3", [m.tenantId, m.itemId, m.warehouseId, newOnHand, newReserved]);
  return mv;
}

/** Weighted-average cost across all warehouses. Call AFTER the receipt movement has been posted. */
export async function applyReceiptCost(db: Db, tenantId: string, itemId: string, qty: number, unitCost: number) {
  const it = (await db.query("select avg_cost_paise from items where id=$1 and tenant_id=$2 for update", [itemId, tenantId])).rows[0];
  const onHandNow = Number((await db.query("select coalesce(sum(on_hand),0) s from stock_balances where tenant_id=$1 and item_id=$2", [tenantId, itemId])).rows[0].s);
  const before = Math.max(0, onHandNow - qty);
  const newAvg = onHandNow <= 0 ? unitCost : Math.round((before * it.avg_cost_paise + qty * unitCost) / onHandNow);
  await db.query("update items set avg_cost_paise=$3 where id=$1 and tenant_id=$2", [itemId, tenantId, newAvg]);
}

/** Reserve up to `want` (milli) from available stock; returns what was actually reserved. Serialised per balance row. */
export async function reserveStock(db: Db, tenantId: string, itemId: string, wh: string, want: number): Promise<number> {
  if (want <= 0) return 0;
  const b = await lockBalance(db, tenantId, itemId, wh);
  const avail = b.on_hand - b.reserved;
  const take = Math.max(0, Math.min(want, avail));
  if (take > 0) await db.query("update stock_balances set reserved = reserved + $4 where tenant_id=$1 and item_id=$2 and warehouse_id=$3", [tenantId, itemId, wh, take]);
  return take;
}
export async function releaseReservation(db: Db, tenantId: string, itemId: string, wh: string, qty: number) {
  if (qty <= 0) return;
  const b = await lockBalance(db, tenantId, itemId, wh);
  if (b.reserved < qty) throw new UserError("Reservation mismatch while releasing stock");
  await db.query("update stock_balances set reserved = reserved - $4 where tenant_id=$1 and item_id=$2 and warehouse_id=$3", [tenantId, itemId, wh, qty]);
}

/**
 * After stock arrives, give it to confirmed orders that are short, oldest order first.
 */
export async function autoAllocate(db: Db, tenantId: string, itemId: string, wh: string) {
  const lines = (await db.query(
    `select l.id, l.qty, l.reserved_qty, l.dispatched_qty from sales_order_lines l join sales_orders o on o.id=l.order_id and o.tenant_id=l.tenant_id
      where l.tenant_id=$1 and l.item_id=$2 and o.warehouse_id=$3 and o.status in ('confirmed','partially_fulfilled')
        and l.qty > l.reserved_qty + l.dispatched_qty order by o.created_at, l.line_no for update of l`, [tenantId, itemId, wh])).rows;
  for (const l of lines) {
    const got = await reserveStock(db, tenantId, itemId, wh, l.qty - l.reserved_qty - l.dispatched_qty);
    if (got > 0) await db.query("update sales_order_lines set reserved_qty = reserved_qty + $2 where id=$1", [l.id, got]);
  }
}

export async function ledgerReconciliation(db: Db, tenantId: string) {
  return (await db.query(
    `select b.item_id, b.warehouse_id, b.on_hand, coalesce(m.s,0)::bigint as ledger_sum
       from stock_balances b left join (select item_id, warehouse_id, sum(qty_delta) s from stock_movements where tenant_id=$1 group by 1,2) m
         on m.item_id=b.item_id and m.warehouse_id=b.warehouse_id where b.tenant_id=$1 and b.on_hand <> coalesce(m.s,0)`, [tenantId])).rows;
}
