import type { Db } from "../db";
import type { TCtx } from "../actions";
import { UserError } from "../errors";
import { audit } from "../audit";
import { moveStock, applyReceiptCost } from "./inventory";
import { postJournal, today } from "./ledger";
import { mulDiv } from "../money";
import { ruleFor, requestApproval, onDecision } from "./approvals";

const num = async (db: Db, t: string, k: string) => (await db.query("select next_number($1,$2) n", [t, k])).rows[0].n as string;

// ---------- transfers with in-transit stock ----------
export async function createTransfer(db: Db, ctx: TCtx, i: { itemId: string; from: string; to: string; qty: number }) {
  if (i.from === i.to) throw new UserError("Choose two different warehouses.");
  const it = (await db.query("select avg_cost_paise, name from items where id=$1 and tenant_id=$2", [i.itemId, ctx.tenant.id])).rows[0];
  if (!it) throw new UserError("Item not found");
  const number = await num(db, ctx.tenant.id, "transfer");
  const id = (await db.query("insert into stock_transfers(tenant_id,number,from_warehouse_id,to_warehouse_id,item_id,qty,unit_cost_paise,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [ctx.tenant.id, number, i.from, i.to, i.itemId, i.qty, it.avg_cost_paise, ctx.user.id])).rows[0].id as string;
  // only unreserved stock can leave: moveStock refuses to drop on-hand below reserved
  await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: i.itemId, warehouseId: i.from, delta: -i.qty, kind: "transfer_out", unitCost: it.avg_cost_paise, docType: "transfer", docId: id, docLineId: id });
  await db.query("insert into stock_balances(tenant_id,item_id,warehouse_id) values ($1,$2,$3) on conflict do nothing", [ctx.tenant.id, i.itemId, i.to]);
  await db.query("update stock_balances set in_transit = in_transit + $4 where tenant_id=$1 and item_id=$2 and warehouse_id=$3", [ctx.tenant.id, i.itemId, i.to, i.qty]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "transfer.shipped", entityType: "stock_transfer", entityId: id, detail: { number, qty: i.qty } });
  return { id, number };
}
export async function receiveTransfer(db: Db, ctx: TCtx, id: string) {
  const t = (await db.query("select * from stock_transfers where id=$1 for update", [id])).rows[0];
  if (!t) throw new UserError("Transfer not found");
  if (t.status !== "in_transit") throw new UserError(`This transfer is already ${t.status}.`);
  await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: t.item_id, warehouseId: t.to_warehouse_id, delta: t.qty, kind: "transfer_in", unitCost: t.unit_cost_paise, docType: "transfer", docId: id, docLineId: id });
  await db.query("update stock_balances set in_transit = in_transit - $4 where tenant_id=$1 and item_id=$2 and warehouse_id=$3", [ctx.tenant.id, t.item_id, t.to_warehouse_id, t.qty]);
  await db.query("update stock_transfers set status='received', received_at=now() where id=$1", [id]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "transfer.received", entityType: "stock_transfer", entityId: id });
}
export async function cancelTransfer(db: Db, ctx: TCtx, id: string, reason: string) {
  if (reason.trim().length < 3) throw new UserError("Give a reason.", { reason: "Required" });
  const t = (await db.query("select * from stock_transfers where id=$1 for update", [id])).rows[0];
  if (!t || t.status !== "in_transit") throw new UserError("Only in-transit transfers can be cancelled.");
  const out = (await db.query("select id from stock_movements where tenant_id=$1 and doc_type='transfer' and doc_id=$2 and kind='transfer_out'", [ctx.tenant.id, id])).rows[0];
  await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: t.item_id, warehouseId: t.from_warehouse_id, delta: t.qty, kind: "reversal", unitCost: t.unit_cost_paise, docType: "transfer", docId: id, reversesId: out.id, note: reason });
  await db.query("update stock_balances set in_transit = in_transit - $4 where tenant_id=$1 and item_id=$2 and warehouse_id=$3", [ctx.tenant.id, t.item_id, t.to_warehouse_id, t.qty]);
  await db.query("update stock_transfers set status='cancelled' where id=$1", [id]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "transfer.cancelled", entityType: "stock_transfer", entityId: id, reason });
}

// ---------- counts and adjustments ----------
export async function recordCount(db: Db, ctx: TCtx, i: { warehouseId: string; itemId: string; counted: number; reason: string }) {
  if (i.reason.trim().length < 3) throw new UserError("Give a reason or note for the count.", { reason: "Required" });
  const b = (await db.query("select on_hand from stock_balances where tenant_id=$1 and item_id=$2 and warehouse_id=$3", [ctx.tenant.id, i.itemId, i.warehouseId])).rows[0];
  const system = b?.on_hand ?? 0;
  const variance = i.counted - system;
  if (variance === 0) throw new UserError("Counted quantity equals the system quantity; nothing to adjust.");
  const it = (await db.query("select avg_cost_paise from items where id=$1", [i.itemId])).rows[0];
  const number = await num(db, ctx.tenant.id, "stock_count");
  const id = (await db.query("insert into stock_counts(tenant_id,number,warehouse_id,item_id,system_qty,counted_qty,variance_qty,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [ctx.tenant.id, number, i.warehouseId, i.itemId, system, i.counted, variance, i.reason, ctx.user.id])).rows[0].id as string;
  const value = Math.abs(mulDiv(variance, it.avg_cost_paise, 1000));
  const rule = await ruleFor(db, ctx.tenant.id, "stock_adjustment", value);
  if (rule) {
    await requestApproval(db, ctx, { entityType: "stock_adjustment", entityId: id, ref: number, amount: value, permission: rule.approver_permission, impact: { variance_qty: variance, value, direction: variance < 0 ? "stock decreases, expense posted" : "stock increases, gain posted" } });
    return { id, number, pending: true };
  }
  await postCount(db, ctx, id);
  return { id, number, pending: false };
}
export async function postCount(db: Db, ctx: TCtx, id: string) {
  const c = (await db.query("select * from stock_counts where id=$1 for update", [id])).rows[0];
  if (!c || c.status !== "pending") throw new UserError("This count is no longer pending.");
  const it = (await db.query("select avg_cost_paise from items where id=$1", [c.item_id])).rows[0];
  await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: c.item_id, warehouseId: c.warehouse_id, delta: c.variance_qty, kind: "adjustment", unitCost: it.avg_cost_paise, docType: "stock_count", docId: id, docLineId: id, note: c.reason });
  const v = Math.abs(mulDiv(c.variance_qty, it.avg_cost_paise, 1000));
  let j: string | null = null;
  if (v > 0) j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Stock count ${c.number}`, sourceType: "stock_count", sourceId: id,
    lines: c.variance_qty < 0 ? [{ account: "inv_adjust", debit: v }, { account: "inventory", credit: v }] : [{ account: "inventory", debit: v }, { account: "inv_adjust", credit: v }] });
  await db.query("update stock_counts set status='posted', journal_id=$2 where id=$1", [id, j]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "stock_count.posted", entityType: "stock_count", entityId: id, reason: c.reason, detail: { variance: c.variance_qty } });
}
onDecision("stock_adjustment", async (db, ctx, id, ok) => {
  if (!ok) { await db.query("update stock_counts set status='rejected' where id=$1", [id]); return; }
  await postCount(db, ctx, id);
});

/** Opening stock: quantity at cost into a warehouse, balanced against owner equity. */
export async function openingStock(db: Db, ctx: TCtx, i: { itemId: string; warehouseId: string; qty: number; unitCost: number }) {
  const dup = (await db.query("select 1 from stock_movements where tenant_id=$1 and item_id=$2 and warehouse_id=$3 and kind='opening'", [ctx.tenant.id, i.itemId, i.warehouseId])).rowCount;
  if (dup) throw new UserError("Opening stock was already loaded for this item and warehouse. Use a count or adjustment to change it.");
  const doc = (await db.query("select gen_random_uuid() id")).rows[0].id;
  await moveStock(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, itemId: i.itemId, warehouseId: i.warehouseId, delta: i.qty, kind: "opening", unitCost: i.unitCost, docType: "opening", docId: doc, docLineId: doc });
  await applyReceiptCost(db, ctx.tenant.id, i.itemId, i.qty, i.unitCost);
  const v = mulDiv(i.qty, i.unitCost, 1000);
  if (v > 0) await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: "Opening stock", sourceType: "opening", sourceId: doc, lines: [{ account: "inventory", debit: v }, { account: "equity", credit: v }] });
}

export async function reorderSuggestions(db: Db, tenantId: string) {
  return (await db.query(
    `select i.id, i.sku, i.name, i.reorder_level_qty, i.reorder_qty,
            coalesce(sum(b.on_hand - b.reserved),0)::bigint available, coalesce(sum(b.in_transit),0)::bigint in_transit,
            coalesce((select sum(l.qty - l.received_qty) from purchase_order_lines l join purchase_orders p on p.id=l.order_id and p.tenant_id=l.tenant_id where l.tenant_id=i.tenant_id and l.item_id=i.id and p.status in ('approved','sent','acknowledged','partially_received')),0)::bigint on_order
       from items i left join stock_balances b on b.item_id=i.id and b.tenant_id=i.tenant_id where i.tenant_id=$1 and i.kind='goods' and i.status='active' and i.reorder_level_qty > 0
      group by i.id having coalesce(sum(b.on_hand - b.reserved),0) + coalesce(sum(b.in_transit),0) + coalesce((select sum(l.qty - l.received_qty) from purchase_order_lines l join purchase_orders p on p.id=l.order_id and p.tenant_id=l.tenant_id where l.tenant_id=i.tenant_id and l.item_id=i.id and p.status in ('approved','sent','acknowledged','partially_received')),0) <= i.reorder_level_qty
      order by i.sku`, [tenantId])).rows;
}
