import type { Metadata } from "next";
export const metadata: Metadata = { title: "Product" };
const MODS: [string, string[]][] = [
  ["Sales", ["Enquiries and quotations with numbered versions", "Approval by amount", "Accepted quote becomes a sales order at the quoted prices", "Stock reservation, shortage and backorder visibility", "Credit limits with authorised, reasoned overrides", "Order amendment that reconciles reservations and purchasing"]],
  ["Purchasing", ["Purchase requests and approval queue", "Purchase orders, acknowledgement, partial receipt", "Returns to supplier", "Supplier bill matching: ordered vs received vs billed with tolerances", "Supplier performance and document expiry"]],
  ["Inventory", ["On-hand, reserved, available and in-transit shown separately", "Immutable stock movements with controlled reversals", "Transfers between warehouses with in-transit stock", "Counts and adjustments with approval", "Reorder suggestions and barcode labels (USB/keyboard scanners)"]],
  ["Fulfilment", ["Partial dispatch against reserved stock", "Delivery notes, carrier references, proof attachments", "Customer returns with inspection — restock only once"]],
  ["Finance", ["Invoices, receipts, allocations, credit notes, refunds", "Supplier bills and payments, expenses", "Manual journals, reversals, period close with locks", "Trial balance, profit and loss, balance sheet, receivables ageing", "Reconciliation of stock and sub-ledgers to the ledger"]],
  ["Projects, people, assets", ["Projects with budget, tasks, approved time and costs", "Employee directory with restricted personal data", "Leave requests, joining and exit checklists", "Asset register, breakdown tickets, service reports"]],
  ["Platform", ["Multiple companies per login with explicit switching", "Roles and permissions, branch assignment, session revocation", "Two-factor authentication", "CSV imports, exports, API keys and signed webhooks", "Full audit trail"]],
];
export default function Features() {
  return (
    <div className="wrap section">
      <h1>Product</h1><p className="muted narrow">Everything below is part of the standard product. Items outside it are listed on the Solutions page.</p>
      <div className="grid g2">{MODS.map(([t, l]) => <div className="card" key={t}><h2>{t}</h2><ul>{l.map((x) => <li key={x}>{x}</li>)}</ul></div>)}</div>
    </div>
  );
}
