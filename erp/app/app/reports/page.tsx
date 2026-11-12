import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { PageHead } from "@/components/ui";
const R: [string, string, string, string, string][] = [
  ["Trial balance", "finance.view", "/app/finance/trial-balance", "Ledger balances by account", "Live"], ["Profit & loss", "finance.view", "/app/finance/pnl", "Income and expense for a date range", "Live"], ["Balance sheet", "finance.view", "/app/finance/balance-sheet", "Assets, liabilities, equity", "Live"],
  ["Receivables ageing", "finance.view", "/app/reports/ageing", "Unpaid invoices by days overdue", "Live"], ["Payables", "finance.view", "/app/procurement/bills?status=posted", "Open supplier bills", "Live"], ["Stock on hand", "inventory.view", "/app/inventory", "On hand / reserved / available", "Live"],
  ["Shortages", "sales.view", "/app/sales/shortages", "Orders waiting for stock", "Live"], ["Sales margin", "finance.view", "/app/reports/margin", "Revenue vs cost of goods by item", "Live"], ["Supplier performance", "procurement.view", "/app/procurement/performance", "Fill and return rates", "Live"],
  ["Reconciliation", "finance.view", "/app/finance/reconciliation", "Operations vs ledger", "Live"], ["Cash summary", "finance.view", "/app/reports/cash", "Receipts and payments by month", "Live"],
];
export default async function Reports() {
  const ctx = await requireTenant("reports.view");
  return (<><PageHead title="Report library" crumbs={[["Reports"]]} sub="Every report reads live data (no stale snapshot), respects your role and branch access, and drills down to source documents." />
    <div className="grid g3">{R.filter((r) => ctx.perms.has(r[1])).map((r) => <Link key={r[0]} href={r[2]} className="card" style={{ textDecoration: "none", color: "inherit" }}><h3>{r[0]}</h3><p className="muted small">{r[3]}</p></Link>)}</div>
    <p className="small muted">Exports (CSV): {["customers", "items", "stock", "invoices", "orders", "bills", "journals", "stock-ledger"].filter(() => ctx.perms.has("reports.export")).map((k) => <a key={k} href={`/app/export/${k}`} style={{ marginRight: 10 }}>{k}</a>)}</p></>);
}
