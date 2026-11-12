import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { title: "Solutions" };
export default function Solutions() {
  return (
    <div className="wrap section">
      <h1>Solutions</h1>
      <div className="grid g2">
        <div className="card"><h2>Trading & distribution</h2><p className="muted">Buy, store and sell goods across branches and warehouses with reserved stock, partial deliveries and receivables control.</p></div>
        <div className="card"><h2>Professional & field services</h2><p className="muted">Quote and deliver service work with projects, approved time and expenses, milestone invoices and asset maintenance.</p></div>
      </div>
      <h2 style={{ marginTop: 32 }}>Available as separate extensions</h2>
      <p className="muted narrow">These are not part of the standard product and are scoped and priced individually: manufacturing (bills of material, routings, MRP, production orders, WIP, costing), batch/expiry/serial traceability, payroll and statutory deductions, e-invoicing and statutory filing, multi-currency consolidation, handheld offline apps, courier integrations, restaurant POS, school, healthcare and construction packages.</p>
      <Link className="btn" href="/demo">Discuss an extension</Link>
    </div>
  );
}
