import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { getSession } from "@/lib/auth/session";
import { HOME_BY_ROLE } from "@/lib/rules/routing";

export const metadata: Metadata = { title: "Hospital operations in one place" };
export const dynamic = "force-dynamic";

const POINTS = [
  ["From front desk to bedside", "Register patients, book appointments, admit, allocate beds, transfer and discharge in one connected record."],
  ["Every clinic kept apart", "Each organisation's patients, staff, files and finances are isolated by the database itself, not just by the screens."],
  ["Safe by design", "Role-based access, an append-only audit trail, signed notes that lock, and corrections that keep the original."],
  ["Hospital-defined rules", "Deposit and emergency-discharge policies are switches your hospital controls, not rules we impose."],
] as const;

export default async function Home() {
  const session = await getSession();
  if (session) redirect(HOME_BY_ROLE[session.role]);
  return (
    <>
      <section className="py-section">
        <h1 className="max-w-3xl text-display font-bold text-ink-900">Run clinics and wards from one calm, reliable system.</h1>
        <p className="mt-4 max-w-prose text-lg text-ink-700">Patient registration, appointments, consultations, billing, inpatient beds, nursing records and discharge governance, with access that follows each person's role.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/demo" className={buttonClass("primary")}>Request a demo</Link>
          <Link href="/features" className={buttonClass("secondary")}>See what's included</Link>
        </div>
      </section>
      <section aria-label="Highlights" className="grid gap-gutter md:grid-cols-2">
        {POINTS.map(([t, d]) => (
          <div key={t} className="rounded-lg border border-line bg-surface p-6 shadow-card"><h2 className="text-title font-bold">{t}</h2><p className="mt-2 text-ink-700">{d}</p></div>
        ))}
      </section>
    </>
  );
}
