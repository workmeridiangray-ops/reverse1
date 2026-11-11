"use server";
import { act, must, num, str } from "@/lib/action";
import { parseInr } from "@/lib/rules/money";
import { parseLots, totalQty, type Tracking } from "@/lib/rules/lots";

// ---- masters
export async function saveCustomer(f: FormData) {
  await act("/app/customers", "/app/customers", "Customer saved", async (sb) => {
    const limit = str(f, "credit_limit");
    must(await sb.from("customers").insert({
      tenant_id: (await sb.rpc("current_tenant")).data, name: str(f, "name"), email: str(f, "email") || null, phone: str(f, "phone") || null, gstin: str(f, "gstin") || null,
      credit_limit_paise: limit ? parseInr(limit) : null }).select());
  });
}
export async function saveSupplier(f: FormData) {
  await act("/app/suppliers", "/app/suppliers", "Supplier saved", async (sb) => {
    must(await sb.from("suppliers").insert({ tenant_id: (await sb.rpc("current_tenant")).data, name: str(f, "name"), email: str(f, "email") || null, phone: str(f, "phone") || null, gstin: str(f, "gstin") || null }).select());
  });
}
export async function saveItem(f: FormData) {
  await act("/app/items", "/app/items", "Item saved", async (sb) => {
    must(await sb.from("items").insert({
      tenant_id: (await sb.rpc("current_tenant")).data, sku: str(f, "sku"), name: str(f, "name"), kind: str(f, "kind") || "stock", unit: str(f, "unit") || "nos",
      sale_price_paise: parseInr(str(f, "price") || "0"), cost_paise: parseInr(str(f, "cost") || "0"),
      tax_code_id: str(f, "tax_code_id") || null, reorder_level: num(f, "reorder") || 0,
      tracking: str(f, "tracking") || "none", barcode: str(f, "barcode") || null }).select());
  });
}
export async function setActive(f: FormData) {
  const table = str(f, "table"); const back = str(f, "back");
  if (!["customers", "suppliers", "items"].includes(table)) throw new Error("bad table");
  await act(back, back, "Updated", async (sb) => { must(await sb.from(table).update({ active: str(f, "active") === "true" }).eq("id", str(f, "id")).select()); });
}

// ---- sales
export async function createOrder(f: FormData) {
  await act("/app/sales/new", "/app/sales", "Order created", async (sb) => {
    const lines: { item_id: string; qty: number; discount_bp?: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const item = str(f, `item_${i}`); if (!item) continue;
      const qty = str(f, `qty_${i}`); if (!/^\d+(\.\d{1,3})?$/.test(qty) || Number(qty) <= 0) throw new Error(`Line ${i + 1}: enter a quantity above zero (up to 3 decimals)`);
      const d = str(f, `disc_${i}`);
      lines.push({ item_id: item, qty: Number(qty), discount_bp: d ? Math.round(Number(d) * 100) : 0 });
    }
    if (!lines.length) throw new Error("Add at least one line");
    const id = must(await sb.rpc("create_sales_order", { p_customer: str(f, "customer"), p_warehouse: str(f, "warehouse"), p_lines: lines, p_notes: str(f, "notes") }));
    return `/app/sales/${id}`;
  });
}
export async function confirmOrder(f: FormData) {
  const id = str(f, "id"); const back = `/app/sales/${id}`;
  await act(back, back, "Order confirmed", async (sb) => {
    const rows = must(await sb.rpc("confirm_sales_order", { p_order: id, p_override_reason: str(f, "override") || null })) as any[];
    if (rows?.length) return `${back}?short=${rows.length}`;
  });
}
export async function cancelOrder(f: FormData) {
  const id = str(f, "id"); const back = `/app/sales/${id}`;
  await act(back, back, "Order cancelled", async (sb) => { must(await sb.rpc("cancel_sales_order", { p_order: id, p_reason: str(f, "reason") })); });
}
export async function requestPurchases(f: FormData) {
  const id = str(f, "id"); const back = `/app/sales/${id}`;
  await act(back, "/app/purchasing", "Purchase requests created", async (sb) => { must(await sb.rpc("request_shortage_purchases", { p_order: id })); });
}
export async function dispatchOrder(f: FormData) {
  const id = str(f, "id"); const back = `/app/sales/${id}`;
  await act(back, back, "Dispatch recorded", async (sb) => {
    const ids = [...f.keys()].filter((k) => k.startsWith("d_") || k.startsWith("lots_")).map((k) => k.replace(/^(d_|lots_)/, ""));
    const { data: sls } = await sb.from("sales_order_lines").select("id, items(sku, tracking)").in("id", [...new Set(ids)]);
    const lines: { so_line_id: string; qty: number; lots?: { code: string; qty: number }[] }[] = [];
    for (const sl of (sls ?? []) as any[]) {
      const tracking = (sl.items?.tracking ?? "none") as Tracking;
      let qty = Number(str(f, `d_${sl.id}`) || 0);
      const text = str(f, `lots_${sl.id}`);
      if (tracking !== "none" && text) {
        const { lots, errors } = parseLots(text, tracking);
        if (errors.length) throw new Error(`${sl.items.sku}: ${errors[0]}`);
        const sum = totalQty(lots);
        if (qty && qty !== sum) throw new Error(`${sl.items.sku}: the lots add up to ${sum} but the quantity is ${qty}`);
        qty = sum;
        if (qty > 0) lines.push({ so_line_id: sl.id, qty, lots: lots.map((l) => ({ code: l.code, qty: l.qty })) });
      } else if (qty > 0) lines.push({ so_line_id: sl.id, qty });
    }
    if (!lines.length) throw new Error("Enter a quantity to dispatch");
    must(await sb.rpc("dispatch_order", { p_order: id, p_lines: lines, p_carrier_ref: str(f, "carrier") || null }));
  });
}
export async function invoiceOrder(f: FormData) {
  const id = str(f, "id"); const back = `/app/sales/${id}`;
  await act(back, back, "Invoice posted", async (sb) => { const inv = must(await sb.rpc("invoice_order", { p_order: id })); return `/app/invoices/${inv}`; });
}

// ---- purchasing
export async function approveRequest(f: FormData) {
  await act("/app/purchasing", "/app/purchasing", "Purchase order created", async (sb) => {
    const po = must(await sb.rpc("approve_purchase_request", { p_request: str(f, "id"), p_supplier: str(f, "supplier"), p_unit_cost_paise: parseInr(str(f, "cost")) }));
    return `/app/purchasing/${po}`;
  });
}
export async function rejectRequest(f: FormData) {
  await act("/app/purchasing", "/app/purchasing", "Request rejected", async (sb) => { must(await sb.rpc("reject_purchase_request", { p_request: str(f, "id"), p_reason: str(f, "reason") })); });
}
export async function receiveGoods(f: FormData) {
  const id = str(f, "id"); const back = `/app/purchasing/${id}`;
  await act(back, back, "Goods received", async (sb) => {
    const { data: pls } = await sb.from("purchase_order_lines").select("id, items(sku, tracking)").eq("po_id", id);
    const lines: { po_line_id: string; qty: number; lots?: { code: string; qty: number; expiry?: string }[] }[] = [];
    for (const pl of (pls ?? []) as any[]) {
      const tracking = (pl.items?.tracking ?? "none") as Tracking;
      if (tracking === "none") { const q = Number(str(f, `r_${pl.id}`) || 0); if (q > 0) lines.push({ po_line_id: pl.id, qty: q }); continue; }
      const text = str(f, `lots_${pl.id}`); if (!text) continue;
      const { lots, errors } = parseLots(text, tracking);
      if (errors.length) throw new Error(`${pl.items.sku}: ${errors[0]}`);
      lines.push({ po_line_id: pl.id, qty: totalQty(lots), lots });
    }
    if (!lines.length) throw new Error("Enter a received quantity");
    must(await sb.rpc("receive_goods", { p_po: id, p_lines: lines, p_key: str(f, "key") || null }));
  });
}
export async function postBill(f: FormData) {
  const id = str(f, "id"); const back = `/app/purchasing/${id}`;
  await act(back, back, "Supplier bill posted", async (sb) => {
    must(await sb.rpc("post_supplier_bill", { p_po: id, p_supplier_ref: str(f, "ref"), p_billed_subtotal_paise: parseInr(str(f, "subtotal")), p_exception_reason: str(f, "reason") || null }));
  });
}
export async function payBill(f: FormData) {
  const id = str(f, "po"); const back = `/app/purchasing/${id}`;
  await act(back, back, "Payment recorded", async (sb) => { must(await sb.rpc("pay_supplier_bill", { p_bill: str(f, "bill"), p_amount_paise: parseInr(str(f, "amount")) })); });
}

// ---- inventory
export async function adjustStock(f: FormData) {
  await act("/app/inventory", "/app/inventory", "Stock adjusted", async (sb) => {
    must(await sb.rpc("adjust_stock", { p_item: str(f, "item"), p_warehouse: str(f, "warehouse"), p_delta: Number(str(f, "delta")), p_reason: str(f, "reason"), p_lot: str(f, "lot") || null, p_expiry: str(f, "expiry") || null }));
  });
}

// ---- finance
export async function receivePayment(f: FormData) {
  const back = "/app/invoices"; 
  await act(back, back, "Receipt recorded", async (sb) => {
    const alloc = [...f.keys()].filter((k) => k.startsWith("a_")).map((k) => ({ invoice_id: k.slice(2), amount_paise: str(f, k) ? parseInr(str(f, k)) : 0 })).filter((a) => a.amount_paise > 0);
    if (!alloc.length) throw new Error("Allocate the receipt to at least one invoice");
    must(await sb.rpc("record_payment", { p_customer: str(f, "customer"), p_method: str(f, "method"), p_alloc: alloc, p_reference: str(f, "reference") || null }));
  });
}
export async function manualJournal(f: FormData) {
  await act("/app/finance", "/app/finance", "Journal posted", async (sb) => {
    const lines = [0, 1, 2, 3].map((i) => ({ account_code: str(f, `acc_${i}`), debit: str(f, `dr_${i}`) ? parseInr(str(f, `dr_${i}`)) : 0, credit: str(f, `cr_${i}`) ? parseInr(str(f, `cr_${i}`)) : 0 })).filter((l) => l.account_code);
    must(await sb.rpc("post_manual_journal", { p_date: str(f, "date"), p_memo: str(f, "memo"), p_lines: lines }));
  });
}
export async function reverseJournal(f: FormData) {
  await act("/app/finance", "/app/finance", "Journal reversed", async (sb) => { must(await sb.rpc("reverse_journal", { p_entry: str(f, "id"), p_reason: str(f, "reason") })); });
}
export async function closePeriod(f: FormData) {
  await act("/app/finance", "/app/finance", "Period closed", async (sb) => { must(await sb.rpc("lock_period", { p_through: str(f, "through") })); });
}

// ---- settings
export async function addMember(f: FormData) {
  await act("/app/settings", "/app/settings", "Member added", async (sb) => { must(await sb.rpc("add_member_by_email", { p_email: str(f, "email"), p_role: str(f, "role") })); });
}
export async function toggleMember(f: FormData) {
  await act("/app/settings", "/app/settings", "Member updated", async (sb) => { must(await sb.rpc("set_member_active", { p_user: str(f, "user"), p_active: str(f, "active") === "true" })); });
}
export async function choosePlan(f: FormData) {
  await act("/app/settings", "/app/settings", "Plan updated", async (sb) => { must(await sb.rpc("change_plan", { p_plan: str(f, "plan") })); });
}
export async function addBranch(f: FormData) {
  await act("/app/settings", "/app/settings", "Branch added", async (sb) => {
    must(await sb.from("branches").insert({ tenant_id: (await sb.rpc("current_tenant")).data, code: str(f, "code").toUpperCase(), name: str(f, "name") }).select());
  });
}
export async function addWarehouse(f: FormData) {
  await act("/app/settings", "/app/settings", "Warehouse added", async (sb) => {
    must(await sb.from("warehouses").insert({ tenant_id: (await sb.rpc("current_tenant")).data, branch_id: str(f, "branch"), code: str(f, "code").toUpperCase(), name: str(f, "name") }).select());
  });
}
export async function saveWorkspaceSettings(f: FormData) {
  await act("/app/settings", "/app/settings", "Settings saved", async (sb) => {
    const t = (await sb.rpc("current_tenant")).data;
    must(await sb.from("tenants").update({ name: str(f, "name"), credit_check: f.get("credit_check") === "on", bill_tolerance_bp: Math.round(num(f, "tolerance") * 100) }).eq("id", t).select());
  });
}
