import type { createClient } from "@/lib/supabase/server";

type Col = { key: string; label: string; type?: "money" | "qty" };
export const REPORTS: { key: string; title: string; basis: string; table: string; order: string; columns: Col[]; totalKey?: string }[] = [
  { key: "ar", title: "Receivables ageing", basis: "Open invoice balances net of receipts and credit notes; due date = invoice date + customer payment terms.", table: "receivables_ageing", order: "days_overdue",
    columns: [{ key: "customer_name", label: "Customer" }, { key: "number", label: "Invoice" }, { key: "due_date", label: "Due" }, { key: "days_overdue", label: "Days overdue" }, { key: "bucket", label: "Bucket" }, { key: "balance_paise", label: "Balance", type: "money" }], totalKey: "balance_paise" },
  { key: "ap", title: "Payables ageing", basis: "Unpaid supplier bills; due date = bill date + 30 days.", table: "payables_ageing", order: "days_overdue",
    columns: [{ key: "supplier_name", label: "Supplier" }, { key: "number", label: "Bill" }, { key: "supplier_ref", label: "Supplier ref" }, { key: "due_date", label: "Due" }, { key: "bucket", label: "Bucket" }, { key: "balance_paise", label: "Balance", type: "money" }], totalKey: "balance_paise" },
  { key: "stock", title: "Stock valuation", basis: "On-hand quantity × current item cost. Reserved stock is still on hand.", table: "stock_valuation", order: "sku",
    columns: [{ key: "sku", label: "SKU" }, { key: "item_name", label: "Item" }, { key: "warehouse_name", label: "Warehouse" }, { key: "on_hand", label: "On hand", type: "qty" }, { key: "cost_paise", label: "Unit cost", type: "money" }, { key: "value_paise", label: "Value", type: "money" }], totalKey: "value_paise" },
  { key: "expiry", title: "Expiry (next 90 days)", basis: "Lots with stock on hand that expire within 90 days or already have.", table: "expiry_report", order: "expiry_date",
    columns: [{ key: "sku", label: "SKU" }, { key: "item_name", label: "Item" }, { key: "lot_code", label: "Lot" }, { key: "warehouse_name", label: "Warehouse" }, { key: "expiry_date", label: "Expires" }, { key: "days_to_expiry", label: "Days left" }, { key: "on_hand", label: "On hand", type: "qty" }] },
  { key: "margin", title: "Sales margin", basis: "Invoice net minus the cost of goods at dispatch, per invoice line. Credit notes are not netted here.", table: "sales_margin", order: "invoice_date",
    columns: [{ key: "number", label: "Invoice" }, { key: "invoice_date", label: "Date" }, { key: "sku", label: "SKU" }, { key: "qty", label: "Qty", type: "qty" }, { key: "net_paise", label: "Net sales", type: "money" }, { key: "cogs_paise", label: "Cost", type: "money" }, { key: "margin_paise", label: "Margin", type: "money" }], totalKey: "margin_paise" },
];

export async function loadReport(sb: Awaited<ReturnType<typeof createClient>>, key: string) {
  const def = REPORTS.find((r) => r.key === key)!;
  const { data } = await sb.from(def.table).select(def.columns.map((c) => c.key).join(",")).order(def.order, { ascending: key === "stock" || key === "expiry" }).limit(1000);
  return (data ?? []) as unknown as Record<string, unknown>[];
}
