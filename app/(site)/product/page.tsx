import { Page } from "@/components/ui";
const mods: [string, string][] = [
  ["Masters & engineering", "Plants, warehouses, work centres, items with revisions and approved unit conversions. Multi-level BOMs and routings with cycle detection, effective dates and approved engineering changes that show affected open jobs."],
  ["Sales & demand", "Enquiry-to-order with cost estimates kept separate from actuals, forecasts netted against confirmed orders, make-to-stock vs make-to-order, and shortage previews."],
  ["MRP & scheduling", "Bounded deterministic MRP with explicit infinite-capacity assumption, run snapshots, and deliberate release. Manual scheduling with dependency checks and preserved schedule history."],
  ["Procurement & subcontracting", "Maker-checker purchase approval, partial receipts, over-receipt protection, material sent to subcontractors with return and loss reconciliation."],
  ["Inventory & traceability", "Immutable stock ledger with approved reversals, batches, serials, quarantine, counts and adjustments, forward/backward genealogy and recall trace."],
  ["Shop floor", "Operation queue with large-target start/pause/finish, material issue, output and scrap, rework jobs, downtime, and supervisor corrections."],
  ["Quality", "Incoming, in-process and final inspections; failures route to rework, return, concession or scrap with reasons and authority."],
  ["Costing & reporting", "Job cost by material, labour and overhead, variance, period close, CSV accounting export. Shortage, yield, scrap and supplier reports."],
  ["Portals", "Customers see approved order milestones and dispatch documents; suppliers see their purchase orders and schedule."],
];
export const metadata = { title: "Product" };
export default function P() {
  return <div className="mx-auto max-w-6xl"><Page title="Product" sub="Everything is linked by stable source references, so a number on a report drills down to the movement that produced it.">
    <div className="grid gap-4 sm:grid-cols-2">{mods.map(([t, d]) => <div key={t} className="card p-5"><h2 className="font-semibold">{t}</h2><p className="mt-2 text-sm text-muted">{d}</p></div>)}</div>
    <p className="mt-6 text-sm text-muted">Not included in this edition: continuous/process manufacturing, regulated-industry validation, advanced optimisation solvers, CAD/PLM, PLC/IoT, statutory accounting and payroll. See <a className="text-brand underline" href="/addons">add-ons</a>.</p>
  </Page></div>;
}
