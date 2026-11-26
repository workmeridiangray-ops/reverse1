"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireSession } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { parseMajor } from "@/lib/rules/money";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function go(path: string, kind: "ok" | "error", message: string): never {
  revalidatePath(path); revalidatePath("/purchasing"); revalidatePath("/stores"); revalidatePath("/assets");
  redirect(`${path}?${new URLSearchParams({ [kind]: message })}`);
}
const uid = (f: FormData, k: string, back: string) => { const v = str(f, k); if (!UUID.test(v)) go(back, "error", "That link is not valid. Reload and try again."); return v; };
const whole = (f: FormData, k: string, back: string, label: string, min = 1): number => {
  const n = Number(str(f, k)); if (!Number.isInteger(n) || n < min || n > 1_000_000) go(back, "error", `${label} must be a whole number${min ? " of at least " + min : ""}.`); return n;
};
function msg(m: string): string {
  if (/suppliers_clinic_id_name_key/.test(m)) return "A supplier with that name already exists.";
  if (/store_items_clinic_id_name_key/.test(m)) return "An item with that name already exists.";
  if (/store_locations_clinic_id_name_key/.test(m)) return "A location with that name already exists.";
  if (/store_one_main/.test(m)) return "There is already a main store.";
  if (/assets_clinic_id_tag_key/.test(m)) return "An asset with that tag already exists.";
  if (/check constraint/.test(m)) return "A value is missing or out of range. Check the form (asset tags use capitals, digits and dashes).";
  return friendlyDbError(m);
}
async function rpc(back: string, name: string, args: Record<string, unknown>, ok: string) {
  const { error } = await (await createClient()).rpc(name as never, args as never);
  if (error) go(back, "error", msg(error.message));
  go(back, "ok", ok);
}

export async function requestPurchase(form: FormData): Promise<void> {
  const s = await requireSession(); const back = "/purchasing";
  let price = 0; try { price = parseMajor(str(form, "price") || "0", s.clinic.currency); } catch { go(back, "error", "Enter the estimated price like 12.50, or leave it empty."); }
  await rpc(back, "request_purchase", { p_item: uid(form, "item_id", back), p_qty: whole(form, "qty", back, "Quantity"), p_price: price, p_reason: str(form, "reason") }, "Request sent for approval.");
}
export async function decideRequest(form: FormData): Promise<void> {
  await requireRole("admin"); const back = "/purchasing"; const approve = str(form, "decision") === "approve";
  await rpc(back, "decide_request", { p_req: uid(form, "request_id", back), p_approve: approve, p_note: str(form, "note") || null }, approve ? "Request approved." : "Request rejected.");
}
export async function createPo(form: FormData): Promise<void> {
  await requireRole("admin"); const back = "/purchasing";
  const ids = form.getAll("request_ids").map(String).filter((v) => UUID.test(v));
  const { data, error } = await (await createClient()).rpc("create_po", { p_supplier: uid(form, "supplier_id", back), p_requests: ids });
  if (error) go(back, "error", msg(error.message));
  redirect(`/purchasing/orders/${data}?ok=${encodeURIComponent("Draft order created. A second admin must approve it.")}`);
}
export async function approvePo(form: FormData): Promise<void> {
  await requireRole("admin"); const id = uid(form, "po_id", "/purchasing");
  await rpc(`/purchasing/orders/${id}`, "approve_po", { p_po: id }, "Order approved. Goods can now be received.");
}
export async function receiveGoods(form: FormData): Promise<void> {
  await requireRole("admin", "nurse"); const id = uid(form, "po_id", "/purchasing"); const back = `/purchasing/orders/${id}`;
  await rpc(back, "receive_goods", { p_line: uid(form, "line_id", back), p_qty: whole(form, "qty", back, "Quantity"), p_delivery_note: str(form, "delivery_note"), p_location: uid(form, "location_id", back) }, "Goods received into the store.");
}
export async function setSupplierBill(form: FormData): Promise<void> {
  await requireRole("admin"); const id = uid(form, "po_id", "/purchasing");
  await rpc(`/purchasing/orders/${id}`, "set_supplier_bill", { p_po: id, p_ref: str(form, "ref") }, "Supplier bill reference saved.");
}
export async function addSupplier(form: FormData): Promise<void> { await requireRole("admin"); await rpc("/purchasing", "add_supplier", { p_name: str(form, "name"), p_contact: str(form, "contact") }, "Supplier added."); }
export async function addItem(form: FormData): Promise<void> { await requireRole("admin"); await rpc("/stores", "add_store_item", { p_name: str(form, "name"), p_unit: str(form, "unit"), p_reorder: whole(form, "reorder", "/stores", "Reorder level", 0) }, "Item added."); }
export async function addLocation(form: FormData): Promise<void> { await requireRole("admin"); await rpc("/stores", "add_store_location", { p_name: str(form, "name"), p_main: form.get("main") === "on" }, "Location added."); }
export async function issueStock(form: FormData): Promise<void> {
  await requireRole("admin", "nurse", "pharmacist", "lab"); const b = "/stores";
  await rpc(b, "issue_stock", { p_item: uid(form, "item_id", b), p_from: uid(form, "location_id", b), p_qty: whole(form, "qty", b, "Quantity"), p_to: str(form, "to") }, "Stock issued.");
}
export async function transferStock(form: FormData): Promise<void> {
  await requireRole("admin", "nurse", "pharmacist", "lab"); const b = "/stores";
  await rpc(b, "transfer_stock", { p_item: uid(form, "item_id", b), p_from: uid(form, "from_id", b), p_to: uid(form, "to_id", b), p_qty: whole(form, "qty", b, "Quantity") }, "Stock transferred.");
}
export async function countStock(form: FormData): Promise<void> {
  await requireRole("admin", "nurse", "pharmacist", "lab"); const b = "/stores";
  await rpc(b, "stock_count", { p_item: uid(form, "item_id", b), p_loc: uid(form, "location_id", b), p_counted: whole(form, "counted", b, "Counted quantity", 0), p_reason: str(form, "reason") }, "Count recorded.");
}
export async function registerAsset(form: FormData): Promise<void> {
  await requireRole("admin"); const d = str(form, "next_service");
  await rpc("/assets", "register_asset", { p_tag: str(form, "tag"), p_name: str(form, "name"), p_category: str(form, "category"), p_location: str(form, "location"), p_next_service: (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null) }, "Asset registered.");
}
export async function recordService(form: FormData): Promise<void> {
  await requireRole("admin"); const d = str(form, "next");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) go("/assets", "error", "Enter the next service date.");
  await rpc("/assets", "record_service", { p_asset: uid(form, "asset_id", "/assets"), p_next: d }, "Service recorded.");
}
export async function reportFault(form: FormData): Promise<void> {
  await requireRole("admin", "doctor", "nurse", "lab", "pharmacist", "receptionist");
  await rpc("/assets", "report_fault", { p_asset: uid(form, "asset_id", "/assets"), p_issue: str(form, "issue"), p_priority: str(form, "priority") === "urgent" ? "urgent" : "normal" }, "Fault reported. Maintenance has been alerted.");
}
export async function startMaintenance(form: FormData): Promise<void> { await requireRole("admin"); await rpc("/assets", "start_maintenance", { p_req: uid(form, "req_id", "/assets") }, "Work started. The asset is marked under maintenance."); }
export async function resolveMaintenance(form: FormData): Promise<void> { await requireRole("admin"); await rpc("/assets", "resolve_maintenance", { p_req: uid(form, "req_id", "/assets"), p_resolution: str(form, "resolution") }, "Resolved. The asset is back in service and downtime is recorded."); }
export async function retireAsset(form: FormData): Promise<void> { await requireRole("admin"); await rpc("/assets", "retire_asset", { p_asset: uid(form, "asset_id", "/assets"), p_reason: str(form, "reason") }, "Asset retired."); }
