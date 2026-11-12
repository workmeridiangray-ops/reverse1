import Link from "next/link";

const FLOW = ["Quotation", "Sales order", "Stock reserved", "Shortage → purchase request", "Purchase order", "Goods receipt", "Dispatch", "Invoice", "Collection"];
export default function Home() {
  return (
    <>
      <section className="hero"><div className="wrap">
        <h1>One system from the first quote to the last rupee collected.</h1>
        <p className="lead">Ledgerline connects sales, purchasing, stock, finance, projects and people for growing SMEs and multi-branch companies — with every company’s data kept strictly separate.</p>
        <div className="row"><Link className="btn primary" href="/signup">Start a 14-day free trial</Link><Link className="btn" href="/demo">Request a demo</Link></div>
        <p className="small muted" style={{ marginTop: 16 }}>No card needed for the trial. Billing in INR with GST invoices.</p>
      </div></section>
      <section className="section alt"><div className="wrap">
        <h2>Every step traces to the next</h2>
        <p className="muted">A confirmed sale reserves stock, exposes shortages, raises a purchase request when you allow it, records receipt and dispatch, creates the invoice and tracks collection — and the ledger balances at every step.</p>
        <ol className="row" style={{ listStyle: "none", padding: 0, gap: 8 }}>{FLOW.map((s, i) => <li key={s} className="badge info">{i + 1}. {s}</li>)}</ol>
      </div></section>
      <section className="section"><div className="wrap grid g3">
        {[["Sales & fulfilment", "Quotations with versions and approvals, reservations, credit limits with override reasons, partial dispatch and returns."],
          ["Purchasing & stock", "Requests, approvals, purchase orders, partial receipts, three-way bill matching with tolerances, immutable stock movements."],
          ["Finance", "Double-entry ledger, receivables, payables, credit notes, period locks, trial balance, profit and loss, balance sheet."],
          ["Projects & people", "Projects with budgets and approved time, staff directory with restricted personal data, leave requests, assets and maintenance."],
          ["Approvals & control", "Amount-based rules, separation of duties, delegation, audit trail of sensitive changes."],
          ["Multi-company by design", "Isolated companies, branch-level access, one login across several businesses."]].map(([t, d]) => (
          <div className="card" key={t}><h3>{t}</h3><p className="muted">{d}</p></div>))}
      </div></section>
      <section className="section alt"><div className="wrap">
        <h2>Honest about scope</h2>
        <p className="muted narrow">Ledgerline covers trading and service companies out of the box. Manufacturing (BOMs, MRP, production), batch/serial traceability, payroll, e-invoicing and statutory filing are separate extensions — see <Link href="/solutions">Solutions</Link>.</p>
      </div></section>
    </>
  );
}
