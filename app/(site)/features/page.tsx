import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/Layout";

export const metadata: Metadata = { title: "Features" };

const AVAILABLE: Array<[string, string[]]> = [
  ["Front desk", ["Patient registration with consent records", "Appointment booking with double-booking protection", "Live reception board"]],
  ["Clinicians", ["Doctor's day and consultation notes that lock when signed", "Admission requests and discharge authorisation"]],
  ["Wards and nursing", ["Ward census with bed state", "Bed allocation that cannot double-book, even under simultaneous requests", "Transfers with effective times, planned reservations, billed bed-days kept separate from occupancy", "Observations and care tasks with explicit not-done reasons"]],
  ["Finance", ["Invoices, partial payments, insurance settlement", "Discharge clearance with audited exceptions"]],
  ["Administration", ["Staff roles, wards and beds, hospital policy switches", "Append-only audit log of changes and record views"]],
];
const PLANNED = ["Operating theatre scheduling", "Laboratory and imaging orders and results", "Pharmacy stock, batches and dispensing", "Purchasing, stores and assets", "Patient portal", "Subscription billing and multi-hospital groups"];

export default function Features() {
  return (
    <>
      <PageHeader title="What's included" description="Everything listed under Available is built and tested. Planned items are not yet available." />
      <div className="grid gap-gutter md:grid-cols-2">
        {AVAILABLE.map(([t, items]) => (
          <Card key={t} title={t}><ul className="list-disc pl-5 text-ink-700">{items.map((i) => <li key={i}>{i}</li>)}</ul></Card>
        ))}
        <Card title="Planned, not yet available"><ul className="list-disc pl-5 text-ink-700">{PLANNED.map((i) => <li key={i}>{i}</li>)}</ul></Card>
      </div>
      <p className="mt-section"><Link href="/demo" className="font-bold">Request a demo</Link></p>
    </>
  );
}
