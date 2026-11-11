import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, Card, PageHeader } from "@/components/ui/Layout";
import { Money } from "@/components/ui/Format";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getAnalytics } from "@/lib/data/analytics";
import { type DurationSummary, formatMinutes, formatPercent, MIN_SAMPLE, type Proportion } from "@/lib/rules/analytics";
import { formatMoney } from "@/lib/rules/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";
const PERIODS = [7, 30, 90] as const;

function DurationCard({ title, hint, s, unit = "visits" }: { title: string; hint: string; s: DurationSummary; unit?: string }) {
  return (
    <Card title={title}>
      {s.status === "ok" ? (
        <>
          <p className="font-mono text-display">{formatMinutes(s.median!)}</p>
          <p className="text-ink-700">is the typical (median) time. Nine in ten were within <strong>{formatMinutes(s.p90!)}</strong>.</p>
          <p className="mt-1 text-sm text-ink-500">Fastest {formatMinutes(s.fastest!)} · slowest {formatMinutes(s.slowest!)}</p>
        </>
      ) : s.status === "too_few" ? (
        <>
          <p className="text-title font-bold text-ink-700">Too few to judge</p>
          <p className="text-ink-700">Only {s.n} {unit} so far. We need at least {MIN_SAMPLE} before showing a number, so a handful of cases can&apos;t look like a trend.</p>
        </>
      ) : <p className="text-title font-bold text-ink-700">No data in this period</p>}
      <p className="mt-3 text-caption text-ink-500">{hint} · {s.n} {unit} counted{s.excluded ? `, ${s.excluded} left out (missing times)` : ""}</p>
    </Card>
  );
}

function ProportionBlock({ p, render, sample }: { p: Proportion; render?: (n: number) => string; sample?: number }) {
  const r = render ?? String;
  if (p.status === "none") return <p className="text-title font-bold text-ink-700">No data in this period</p>;
  if (p.status === "too_few") return <><p className="text-title font-bold text-ink-700">Too few to judge</p><p className="text-ink-700">{r(p.numerator)} of {r(p.denominator)}{sample !== undefined ? ` across ${sample} invoices` : ""}. Fewer than {MIN_SAMPLE} cases, so no percentage is shown.</p></>;
  return <><p className="font-mono text-display">{formatPercent(p.tenths!)}</p><p className="text-ink-700"><strong>{r(p.numerator)}</strong> of <strong>{r(p.denominator)}</strong></p></>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireRole("admin");
  const { days: d } = await searchParams;
  const days = (PERIODS as readonly number[]).includes(Number(d)) ? Number(d) : 30;
  const supabase = await createClient();
  const a = await getAnalytics(supabase, session, days, new Date());
  const money = (n: number) => formatMoney(n, a.currency);

  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Clinic analytics" description="How the clinic is running. Medians and 90th percentiles, never averages; every percentage shows what it is a percentage of." />
      <nav aria-label="Period" className="mb-gutter flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link key={p} href={`/admin/analytics?days=${p}`} aria-current={p === days ? "page" : undefined}
            className="flex min-h-touch items-center rounded-pill border border-line-strong px-4 font-bold text-ink-700 no-underline aria-[current=page]:border-brand-700 aria-[current=page]:bg-brand-700 aria-[current=page]:text-white">
            Last {p} days
          </Link>
        ))}
      </nav>
      <div className="mb-gutter"><Alert tone="info" title="Why not averages?">One patient who waits three hours drags an average up and says nothing about a typical morning. The median is the middle value; the 90th percentile is the time that nine in ten fell within.</Alert></div>

      <div className="grid gap-gutter md:grid-cols-2 xl:grid-cols-3">
        <DurationCard title="Waiting time" hint="Checked in to seen by the doctor" s={a.wait} />
        <DurationCard title="Time with the doctor" hint="Sent in to visit finished" s={a.visit} />
        <Card title="No-shows">
          <ProportionBlock p={a.noShow} />
          <p className="mt-3 text-caption text-ink-500">No-shows out of visits that either happened or were missed. {a.cancelled} cancelled appointments are not counted as no-shows.</p>
        </Card>
        <Card title="Collected from patients">
          <ProportionBlock p={a.collection} render={money} sample={a.invoiceCount} />
          <p className="mt-3 text-caption text-ink-500">Of what patients owe after insurance, across {a.invoiceCount} invoices issued. An overpayment on one invoice doesn&apos;t cover a shortfall on another.</p>
          <p className="mt-2 text-sm">Awaiting insurers: <strong><Money minor={a.awaitingInsurer.minor} currency={a.currency} /></strong> on {a.awaitingInsurer.count} open claim{a.awaitingInsurer.count === 1 ? "" : "s"}.</p>
        </Card>
        <DurationCard title="Lab turnaround" hint="Ordered to last result in" s={a.labTurnaround} unit="orders" />
        <Card title="Critical lab results">
          {a.criticalAck.status === "ok" ? (
            <><p className="font-mono text-display">{formatMinutes(a.criticalAck.median!)}</p><p className="text-ink-700">typical time until a doctor acknowledged. Nine in ten within <strong>{formatMinutes(a.criticalAck.p90!)}</strong>.</p></>
          ) : a.criticalAck.status === "too_few" ? (
            <><p className="text-title font-bold text-ink-700">Too few to judge</p><p className="text-ink-700">Only {a.criticalAck.n} acknowledged so far (need {MIN_SAMPLE}).</p></>
          ) : <p className="text-title font-bold text-ink-700">None in this period</p>}
          <p className={`mt-3 ${a.criticalOpen ? "font-bold text-danger-fg" : "text-sm text-ink-700"}`}>{a.criticalOpen} critical result{a.criticalOpen === 1 ? "" : "s"} waiting for acknowledgement right now.</p>
        </Card>
      </div>

      <section aria-labelledby="by-doctor" className="mt-section">
        <h2 id="by-doctor" className="mb-3 text-heading font-bold">Waiting time by doctor</h2>
        <div className="rounded-lg border border-line bg-surface p-2 shadow-card">
          <Table caption={`Waiting time for each doctor over the last ${days} days. Doctors with fewer than ${MIN_SAMPLE} visits are not rated.`}>
            <thead><tr><Th>Doctor</Th><Th className="text-right">Visits</Th><Th>Typical (median)</Th><Th>9 in 10 within</Th></tr></thead>
            <tbody>
              {a.waitByDoctor.length === 0 ? <tr><Td colSpan={4} className="text-ink-500">No visits in this period.</Td></tr> : a.waitByDoctor.map(({ doctor, summary: s }) => (
                <tr key={doctor}>
                  <Td className="font-bold">{doctor}</Td>
                  <Td className="text-right font-mono">{s.n}</Td>
                  {s.status === "ok" ? <><Td className="font-mono">{formatMinutes(s.median!)}</Td><Td className="font-mono">{formatMinutes(s.p90!)}</Td></> : <Td colSpan={2} className="text-ink-500">{s.status === "too_few" ? `Too few to judge (need ${MIN_SAMPLE})` : "No data"}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </section>
    </>
  );
}
