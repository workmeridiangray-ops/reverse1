"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { RESOURCES, type FieldDef } from "@/lib/masters";
import { UserError } from "@/lib/errors";
import { parseMoney, parseQty } from "@/lib/money";
import { assertEntitled } from "@/lib/billing";
import { audit } from "@/lib/audit";

function coerce(f: FieldDef, raw: string): unknown {
  if (raw === "") { if (f.required) throw new UserError(`${f.label} is required.`, { [f.name]: "Required" }); return f.type === "money" || f.type === "int" || f.type === "bps" ? (f.type === "bps" ? 0 : 0) : f.type === "qty" ? 0 : null; }
  try {
    switch (f.type) {
      case "money": return raw === "0" ? 0 : parseMoney(raw, f.label);
      case "qty": return raw === "0" ? 0 : parseQty(raw, f.label);
      case "int": { if (!/^\d{1,5}$/.test(raw)) throw new Error(`${f.label} must be a whole number`); return Number(raw); }
      case "bps": { if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) throw new Error(`${f.label} must be a percentage like 18 or 12.5`); const v = Math.round(Number(raw) * 100); if (v > 10000) throw new Error("Rate cannot exceed 100%"); return v; }
      case "email": if (!/^\S+@\S+\.\S+$/.test(raw)) throw new Error("Enter a valid email"); return raw.toLowerCase();
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Use a valid date"); return raw;
      default: return raw;
    }
  } catch (e: any) { throw new UserError(e.message, { [f.name]: e.message }); }
}

export async function saveMasterAction(resource: string, id: string | null, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = RESOURCES[resource];
  if (!r) return { ok: false, error: "Unknown record type" };
  return tenantAction("masters.manage", form, async (ctx, db) => {
    const raw = formObj(form);
    const cols: string[] = [], vals: unknown[] = [];
    for (const f of r.fields) {
      if (id && f.name === r.codeCol && resource !== "items") { /* codes stay editable only for new rows to keep references readable */ }
      cols.push(f.name); vals.push(coerce(f, raw[f.name] ?? ""));
    }
    if (resource === "items" && raw.kind === "service") { /* services never hold stock */ }
    if (resource === "branches" && !id) await assertEntitled(db, ctx.tenant.id, "branches");
    if (id) {
      const sets = cols.map((c, i) => `${c}=$${i + 3}`).join(",");
      const res = await db.query(`update ${r.table} set ${sets} where id=$1 and tenant_id=$2 returning id`, [id, ctx.tenant.id, ...vals]);
      if (!res.rowCount) throw new UserError("Record not found");
      await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: `${resource}.updated`, entityType: resource, entityId: id });
      await saveCustom(db, ctx.tenant.id, resource, id, raw);
      return { ok: true, message: `${r.singular[0].toUpperCase() + r.singular.slice(1)} saved.` };
    }
    const res = await db.query(`insert into ${r.table}(tenant_id,${cols.join(",")}) values ($1,${cols.map((_, i) => `$${i + 2}`).join(",")}) returning id`, [ctx.tenant.id, ...vals]);
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: `${resource}.created`, entityType: resource, entityId: res.rows[0].id });
    await saveCustom(db, ctx.tenant.id, resource, res.rows[0].id, raw);
    return { ok: true, message: `${r.singular[0].toUpperCase() + r.singular.slice(1)} created.`, redirectTo: `/app/masters/${resource}/${res.rows[0].id}` };
  });
}
async function saveCustom(db: any, tenantId: string, entity: string, id: string, raw: Record<string, string>) {
  const defs = (await db.query("select key, kind from custom_fields where tenant_id=$1 and entity=$2 and status='active'", [tenantId, entity])).rows;
  for (const d of defs) {
    const v = raw["cf_" + d.key] ?? "";
    if (v && d.kind === "number" && !/^-?\d+(\.\d+)?$/.test(v)) throw new UserError(`${d.key} must be a number`, { ["cf_" + d.key]: "Not a number" });
    if (v && d.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError(`${d.key} must be a date`, { ["cf_" + d.key]: "Not a date" });
    await db.query("insert into custom_values(tenant_id,entity,record_id,key,value) values ($1,$2,$3,$4,$5) on conflict (tenant_id,entity,record_id,key) do update set value=excluded.value", [tenantId, entity, id, d.key, v || null]);
  }
}

/** Referenced masters are retired, never deleted, so history stays readable. */
export async function setMasterStatusAction(resource: string, id: string, status: "active" | "retired"): Promise<ActionResult> {
  const r = RESOURCES[resource];
  if (!r) return { ok: false, error: "Unknown record type" };
  return tenantAction("masters.manage", null, async (ctx, db) => {
    if (resource === "branches" && status === "retired") {
      const left = Number((await db.query("select count(*) c from branches where tenant_id=$1 and status='active' and id<>$2", [ctx.tenant.id, id])).rows[0].c);
      if (!left) throw new UserError("You need at least one active branch.");
    }
    if (resource === "branches" && status === "active") await assertEntitled(db, ctx.tenant.id, "branches");
    if (resource === "items" && status === "retired") {
      const stock = Number((await db.query("select coalesce(sum(on_hand),0) s from stock_balances where tenant_id=$1 and item_id=$2", [ctx.tenant.id, id])).rows[0].s);
      if (stock > 0) throw new UserError("This item still has stock on hand. Adjust or transfer it out before retiring.");
    }
    await db.query(`update ${r.table} set status=$3 where id=$1 and tenant_id=$2`, [id, ctx.tenant.id, status]);
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: `${resource}.${status}`, entityType: resource, entityId: id });
    return { ok: true, message: status === "retired" ? "Retired. History is kept; it can no longer be used on new documents." : "Reactivated." };
  });
}

export async function addUomAction(itemId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("masters.manage", form, async (ctx, db) => {
    const raw = formObj(form);
    if (!raw.unit) throw new UserError("Enter a unit name.", { unit: "Required" });
    let f: number; try { f = parseQty(raw.factor, "Factor"); } catch (e: any) { throw new UserError(e.message, { factor: e.message }); }
    await db.query("insert into item_uoms(tenant_id,item_id,unit,factor_milli) values ($1,$2,$3,$4)", [ctx.tenant.id, itemId, raw.unit, f]);
    return { ok: true, message: "Unit conversion added." };
  });
}
export async function setPriceAction(listId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("masters.manage", form, async (ctx, db) => {
    const raw = formObj(form);
    if (!raw.item_id) throw new UserError("Choose an item.", { item_id: "Required" });
    let p: number; try { p = parseMoney(raw.price, "Price"); } catch (e: any) { throw new UserError(e.message, { price: e.message }); }
    await db.query("insert into price_list_items(tenant_id,price_list_id,item_id,price_paise) values ($1,$2,$3,$4) on conflict (tenant_id,price_list_id,item_id) do update set price_paise=excluded.price_paise", [ctx.tenant.id, listId, raw.item_id, p]);
    return { ok: true, message: "Price saved." };
  });
}
export async function addBinAction(warehouseId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("masters.manage", form, async (ctx, db) => {
    const raw = formObj(form); if (!raw.code) throw new UserError("Enter a bin code.", { code: "Required" });
    await db.query("insert into bins(tenant_id,warehouse_id,code,description) values ($1,$2,$3,$4)", [ctx.tenant.id, warehouseId, raw.code, raw.description || null]);
    return { ok: true, message: "Bin added." };
  });
}
