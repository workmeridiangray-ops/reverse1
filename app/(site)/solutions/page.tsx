import { Card } from "@/components/ui/Layout";
export const metadata = { title: "Industry solutions" };
const S: Array<[string, string]> = [
  ["General contractors", "Measure, verify and bill client running accounts against a signed BOQ, and track procurement against budget."],
  ["Builders and developers", "Run several projects with shared suppliers and per-project access for managers and consultants."],
  ["Project-management firms", "Give clients and consultants a portal for approved progress, bill review, variations and RFIs without exposing internal margins."],
  ["Infrastructure and specialist contractors", "Item-rate contracts with advance and retention; one agreed contract and billing model per project."],
];
export default function Solutions() {
  return (
    <div className="mx-auto max-w-page px-4 pt-14">
      <h1 className="text-display font-bold">Industry solutions</h1>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">{S.map(([t, d]) => <Card key={t} title={t}><p className="text-ink-700">{d}</p></Card>)}</div>
    </div>
  );
}
