import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Layout";

const CHAIN = ["Tender BOQ", "Budget", "Contract", "Measurement", "Certified bill", "Collection", "Handover"];
const POINTS = [
  ["One quantity trail", "Every BOQ quantity is traced from estimate through measurement, verification, certification and invoice. The same work cannot be billed twice."],
  ["Submitted ≠ certified ≠ collected", "Claimed, certified, invoiced and received amounts stay separate, with retention, advance recovery and disputes shown as visible calculations."],
  ["Isolated companies", "Each business is a separate workspace. Access is enforced in the database, per business, project and role, including client and consultant portals."],
  ["Site-ready", "Daily reports, quantities, photos and RFIs work on a phone. Only approved drawing revisions are shown as current."],
] as const;

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-page px-4 pt-16">
        <p className="text-sm font-bold uppercase tracking-wide text-brand-700">For contractors, builders and project managers</p>
        <h1 className="mt-3 max-w-3xl text-display font-bold sm:text-[2.75rem] sm:leading-[3.25rem]">Control every rupee and every cubic metre, from tender to handover.</h1>
        <p className="mt-4 max-w-prose text-lg text-ink-700">A project ERP that ties estimates, contracts, site progress, procurement, running bills and collections to one set of verified quantities.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className={buttonClass("primary")}>Start a 14-day trial</Link>
          <Link href="/demo" className={buttonClass("secondary")}>Request a demo</Link>
        </div>
      </section>
      <section aria-label="Project chain" className="mx-auto mt-14 max-w-page px-4">
        <ol className="flex flex-wrap gap-2">
          {CHAIN.map((c, i) => <li key={c} className="rounded-pill border border-line bg-surface px-4 py-2 text-sm font-bold text-ink-700"><span className="mr-2 text-ink-500">{i + 1}</span>{c}</li>)}
        </ol>
      </section>
      <section className="mx-auto mt-14 grid max-w-page gap-6 px-4 sm:grid-cols-2">
        {POINTS.map(([t, d]) => <Card key={t} title={t}><p className="text-ink-700">{d}</p></Card>)}
      </section>
    </>
  );
}
