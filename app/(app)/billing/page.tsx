import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateText, Money } from "@/components/ui/Format";
import { EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { sum } from "@/lib/rules/money";
import type { PaymentStatus } from "@/lib/rules/invoice";
import { PAYMENT_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const FILTERS: Record<string, { label: string; statuses: PaymentStatus[] | null }> = {
  owing: { label: "Patient owes", statuses: ["unpaid", "partially_paid"] },
  insurance: { label: "Awaiting insurer", statuses: ["awaiting_insurance"] },
  draft: { label: "Drafts", statuses: ["draft"] },
  paid: { label: "Paid", statuses: ["paid", "overpaid"] },
  all: { label: "All", statuses: null },
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await requireRole("admin", "receptionist");
  const { show } = await searchParams;
  const key = show && show in FILTERS ? show : "owing";
  const filter = FILTERS[key]!;
  const supabase = await createClient();
  let query = supabase
    .from("invoice_balances")
    .select("invoice_id, number, patient_id, created_at, issued_at, total_minor, patient_due_now_minor, balance_due_minor, payment_status, currency, insurance_status")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter.statuses) query = query.in("payment_status", filter.statuses);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const ids = [...new Set(data.map((d) => d.patient_id!).filter(Boolean))];
  const { data: patients } = ids.length ? await supabase.from("patients").select("id, given_name, family_name").in("id", ids) : { data: [] };
  const names = new Map((patients ?? []).map((p) => [p.id, `${p.given_name} ${p.family_name}`]));
  const tz = session.clinic.timezone;
  const currency = session.clinic.currency;
  const owedNow = sum(data.map((d) => Number(d.patient_due_now_minor ?? 0)));

  return (
    <>
      <PageHeader title="Billing" description={<>Patients owe <strong><Money minor={owedNow} currency={currency} /></strong> across the invoices shown.</>}
        actions={<ButtonLink href="/billing/new" variant="primary" icon="plus">New invoice</ButtonLink>} />
      <nav aria-label="Filter invoices" className="mb-gutter">
        <ul className="flex flex-wrap gap-2">
          {Object.entries(FILTERS).map(([k, f]) => (
            <li key={k}>
              <Link href={`/billing?show=${k}`} aria-current={k === key ? "page" : undefined}
                className="flex min-h-touch items-center rounded-pill border border-line-strong px-4 font-bold text-ink-700 no-underline aria-[current=page]:border-brand-700 aria-[current=page]:bg-brand-700 aria-[current=page]:text-white">
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {data.length === 0 ? <EmptyState title="No invoices here" /> : (
        <div className="rounded-lg border border-line bg-surface p-2 shadow-card">
          <Table caption={`Invoices: ${filter.label}`}>
            <thead><tr><Th>Invoice</Th><Th>Patient</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Patient owes now</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.invoice_id} className="hover:bg-canvas">
                  <Td><Link href={`/billing/${i.invoice_id}`} className="font-mono font-bold">{i.number}</Link></Td>
                  <Td>{names.get(i.patient_id!) ?? "Unknown"}</Td>
                  <Td><DateText at={i.issued_at ?? i.created_at!} timeZone={tz} /></Td>
                  <Td className="text-right"><Money minor={Number(i.total_minor)} currency={i.currency!} /></Td>
                  <Td className="text-right font-bold"><Money minor={Number(i.patient_due_now_minor)} currency={i.currency!} /></Td>
                  <Td><Badge visual={PAYMENT_VISUAL[i.payment_status as PaymentStatus]} size="sm" /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
