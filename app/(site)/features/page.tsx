import { Card } from "@/components/ui/Layout";
export const metadata = { title: "Features" };
const F: Array<[string, string]> = [
  ["Projects, BOQ and budgets", "Import a BOQ from CSV with row-level validation. Keep tender rates separate from the internal cost budget, which clients never see."],
  ["Contracts and commercial terms", "Retention, retention cap, advance and recovery rate, and payment terms are frozen into a snapshot when the contract is approved."],
  ["Measurement and verification", "Site engineers record quantities; a different person verifies. Duplicate entries are blocked and hold points stop verification until inspected."],
  ["Running bills", "Cumulative quantities, partial certification, retention, advance recovery and other deductions with visible calculations and exact rounding."],
  ["Variations", "Quantity changes keep the original contract rate. Approval needs a different person, and rejection needs a reason."],
  ["Invoices, receipts, disputes", "Gapless invoice numbers, partial receipts, disputed amounts and a clear outstanding versus undisputed balance."],
  ["Procurement", "Material request → approval → purchase order → goods receipt, with rejected quantities quarantined and committed spend against budget."],
  ["Site operations", "Daily reports with labour and equipment, supervisor verification and returned-for-correction reasons."],
  ["Drawings and RFIs", "A register with revisions; approving a revision supersedes the previous one and every download is logged. RFIs have owners and due dates."],
  ["Client and consultant portals", "External parties see only approved progress, certified bills and decisions they are asked to make, for assigned projects only."],
  ["Quality and handover", "Inspection requests with hold points, snag lists with rectification and verification, and a completion check before closure."],
  ["Administration", "Roles, project assignments, invitations, audit trail, session management and a platform console for the software operator."],
];
export default function Features() {
  return (
    <div className="mx-auto max-w-page px-4 pt-14">
      <h1 className="text-display font-bold">Features</h1>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{F.map(([t, d]) => <Card key={t} title={t}><p className="text-ink-700">{d}</p></Card>)}</div>
    </div>
  );
}
