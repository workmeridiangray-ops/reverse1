export type FieldDef = { name: string; label: string; type: "text" | "email" | "textarea" | "money" | "qty" | "int" | "bps" | "date" | "select"; required?: boolean; options?: "tax_codes" | "price_lists" | "branches" | string[]; hint?: string; col?: string };
export interface Resource {
  table: string; title: string; singular: string; codeCol: string; perm: string; fields: FieldDef[]; listCols: string[]; search: string[];
  assertLimit?: "branches"; extras?: string;
}
const status = ["active", "retired"];
export const RESOURCES: Record<string, Resource> = {
  customers: { table: "customers", title: "Customers", singular: "customer", codeCol: "code", perm: "masters", search: ["code", "name", "email", "gstin"], listCols: ["code", "name", "phone", "credit_limit_paise", "payment_terms_days", "status"],
    fields: [{ name: "code", label: "Code", type: "text", required: true, hint: "Unique short code, e.g. ACME" }, { name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Phone", type: "text" },
      { name: "gstin", label: "GSTIN", type: "text", hint: "15 characters, optional" }, { name: "billing_address", label: "Billing address", type: "textarea" },
      { name: "credit_limit_paise", label: "Credit limit (₹)", type: "money", hint: "0 = no limit" }, { name: "payment_terms_days", label: "Payment terms (days)", type: "int" }, { name: "price_list_id", label: "Price list", type: "select", options: "price_lists" }] },
  suppliers: { table: "suppliers", title: "Suppliers", singular: "supplier", codeCol: "code", perm: "masters", search: ["code", "name", "email", "gstin"], listCols: ["code", "name", "phone", "lead_time_days", "doc_expiry_on", "status"],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Phone", type: "text" }, { name: "gstin", label: "GSTIN", type: "text" },
      { name: "address", label: "Address", type: "textarea" }, { name: "lead_time_days", label: "Lead time (days)", type: "int" }, { name: "payment_terms_days", label: "Payment terms (days)", type: "int" },
      { name: "doc_expiry_on", label: "Compliance document expiry", type: "date", hint: "New orders are blocked after this date" }, { name: "doc_note", label: "Document note", type: "text" }] },
  items: { table: "items", title: "Items & services", singular: "item", codeCol: "sku", perm: "masters", search: ["sku", "name", "barcode"], listCols: ["sku", "name", "kind", "base_unit", "sale_price_paise", "purchase_price_paise", "status"], extras: "item",
    fields: [{ name: "sku", label: "SKU", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "kind", label: "Type", type: "select", options: ["goods", "service"], required: true },
      { name: "base_unit", label: "Base unit", type: "text", required: true, hint: "pcs, kg, m, litre… stock is tracked in this unit" }, { name: "sale_price_paise", label: "Sale price per base unit (₹)", type: "money" }, { name: "purchase_price_paise", label: "Purchase price per base unit (₹)", type: "money" },
      { name: "tax_code_id", label: "Tax code", type: "select", options: "tax_codes" }, { name: "reorder_level_qty", label: "Reorder level", type: "qty", hint: "Suggest reorder when available stock falls to this" }, { name: "reorder_qty", label: "Reorder quantity", type: "qty" }, { name: "barcode", label: "Barcode", type: "text", hint: "EAN/UPC or your own code; scanners type it like a keyboard" }] },
  branches: { table: "branches", title: "Branches", singular: "branch", codeCol: "code", perm: "masters", search: ["code", "name"], listCols: ["code", "name", "gstin", "status"], assertLimit: "branches",
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "address", label: "Address", type: "textarea" }, { name: "gstin", label: "Branch GSTIN", type: "text" }] },
  warehouses: { table: "warehouses", title: "Warehouses", singular: "warehouse", codeCol: "code", perm: "masters", search: ["code", "name"], listCols: ["code", "name", "branch", "status"], extras: "warehouse",
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "branch_id", label: "Branch", type: "select", options: "branches", required: true }] },
  departments: { table: "departments", title: "Departments", singular: "department", codeCol: "code", perm: "masters", search: ["code", "name"], listCols: ["code", "name", "status"],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }] },
  tax_codes: { table: "tax_codes", title: "Tax codes", singular: "tax code", codeCol: "code", perm: "masters", search: ["code", "name"], listCols: ["code", "name", "rate_bps", "status"],
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }, { name: "rate_bps", label: "Rate (%)", type: "bps", required: true, hint: "e.g. 18 for 18% (single combined rate)" }] },
  price_lists: { table: "price_lists", title: "Price lists", singular: "price list", codeCol: "code", perm: "masters", search: ["code", "name"], listCols: ["code", "name", "status"], extras: "pricelist",
    fields: [{ name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true }] },
};
export const CUSTOM_ENTITIES = ["customers", "suppliers", "items"];
export { status as STATUS };
