import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/kit";

export const metadata: Metadata = { title: "Help" };
const FLOW = [
  ["Set up", "Add customers, suppliers and items (or import CSVs). Add warehouses under Settings. Opening stock goes in through Inventory → Stock adjustment."],
  ["Sell", "Sales orders → New order. Confirm to reserve stock. If a line is short, Request purchases."],
  ["Buy", "Purchasing → approve the request with a supplier and cost. Receive goods (partial is fine); waiting orders are reserved automatically. Post the supplier bill; bills outside tolerance need a manager and a reason."],
  ["Ship and bill", "On the order: Dispatch what is reserved, then Create invoice. Record receipts under Invoices & receipts."],
  ["Correct", "Never edit posted documents. Issue a credit note (with optional restock), reverse a manual journal, or adjust stock with a reason."],
  ["Close", "Finance → Close period locks everything on or before the date."],
];
export default function Help() {
  return (
    <>
      <PageHeader title="Help" sub="How a sale flows through the system." />
      <ol className="card max-w-prose space-y-4 p-6">{FLOW.map(([t, d], i) => <li key={t}><p className="font-semibold">{i + 1}. {t}</p><p className="text-muted">{d}</p></li>)}</ol>
      <h2 className="mb-2 mt-8 font-semibold">API</h2>
      <p className="max-w-prose text-muted">Owners can create read-only API keys in Settings. Send <code>Authorization: Bearer berp_…</code> to <code>/api/v1/items</code>, <code>customers</code>, <code>suppliers</code>, <code>stock</code>, <code>sales-orders</code> or <code>invoices</code>. Use <code>?limit=</code> (max 200) and <code>?offset=</code>. 120 requests per minute per key.</p>
    </>
  );
}
