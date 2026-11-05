import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/site";

const FEATURES = [
  ["Sell without surprises", "Quotes become orders; stock is reserved the moment you confirm, and shortages show immediately."],
  ["Buy what you actually need", "A shortage becomes a purchase request, an approval, an order, a partial receipt and a matched supplier bill."],
  ["Stock you can trust", "On-hand, reserved and available are always separate. Every movement is permanent and corrections are reversals."],
  ["Books that balance", "Every invoice, receipt and dispatch posts a balanced journal that traces back to its document. Close periods when you are done."],
  ["Many companies, one login", "Switch workspaces explicitly. Each company's data is isolated at the database, not just in the screens."],
  ["Roles that mean something", "Owner, manager, sales, purchasing, warehouse, accountant and viewer — enforced on the server for every action."],
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="mx-auto max-w-page px-4 py-16 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">Business ERP for trading and service companies</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">From confirmed sale to collected payment, on one record.</h1>
          <p className="mt-5 max-w-prose text-lg text-muted">BERP connects sales, purchasing, inventory and finance so a customer order reserves stock, triggers a purchase when you are short, ships, invoices and reconciles — without re-keying anything.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link className="btn btn-primary" href="/signup">Start a 14-day trial</Link><Link className="btn" href="/pricing">See pricing</Link></div>
        </section>
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-page gap-6 px-4 py-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([t, d]) => <div key={t}><h2 className="font-semibold">{t}</h2><p className="mt-1 text-muted">{d}</p></div>)}
          </div>
        </section>
        <section className="mx-auto max-w-page px-4 py-14">
          <h2 className="text-xl font-semibold">What is included, and what is not</h2>
          <p className="mt-2 max-w-prose text-muted">The core covers trading and service workflows in INR with GST rates. Manufacturing (BOM, MRP, production), full restaurant POS, healthcare, school and construction packages are separate; statutory GST filing, e-invoicing and bank feeds are not part of the core.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
