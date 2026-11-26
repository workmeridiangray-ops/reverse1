import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText, Money } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import type { PaymentStatus } from "@/lib/rules/invoice";
import { PAYMENT_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My care" };
export const dynamic = "force-dynamic";

/** Everything here is filtered by RLS to the signed-in patient's own rows. */
export default async function PatientHome() {
  const session = await requireRole("patient");
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [appts, invoices, meds, results, summaries] = await Promise.all([
    supabase.from("appointments").select("id, starts_at, reason, status, doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name)")
      .gte("starts_at", nowIso).in("status", ["scheduled", "arrived"]).order("starts_at").limit(10),
    supabase.from("invoice_balances").select("invoice_id, number, patient_due_now_minor, payment_status, currency").order("created_at", { ascending: false }),
    supabase.from("prescriptions").select("id, drug_name, dose, frequency").eq("status", "active"),
    supabase.from("lab_results").select("id, order_id, value, unit, reference_range, flag, published_at, version").eq("state", "published").order("published_at", { ascending: false }).limit(20),
    supabase.from("admission_summaries").select("admission_id, summary, shared_at").not("shared_at", "is", null).order("shared_at", { ascending: false }),
  ]);
  const orderIds = (results.data ?? []).map((r) => r.order_id);
  const orders = orderIds.length ? (await supabase.from("lab_orders").select("id, test_name").in("id", orderIds)).data ?? [] : [];
  const on = new Map(orders.map((o) => [o.id, o.test_name]));
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title={`Hello, ${session.fullName.split(" ")[0]}`} />
      <div className="mb-gutter flex flex-col gap-3">
        <Alert tone="info" title="What you can see here">Only information your care team has reviewed and released. Results appear after they are checked, so there can be a delay. This page is not monitored for emergencies: if you feel unwell, call your local emergency number or go to the nearest emergency department.</Alert>
        <Alert tone="info" title="Paying a bill">Online payment is not available yet. Please pay at the front desk or ask them to send payment details.</Alert>
      </div>
      <div className="grid gap-gutter lg:grid-cols-3">
        <Card title="Upcoming appointments">
          {!appts.data?.length ? <EmptyState title="Nothing booked" /> : (
            <ul className="flex flex-col gap-3">
              {appts.data.map((a) => (
                <li key={a.id}><p className="font-bold"><DateTimeText at={a.starts_at} timeZone={tz} /></p><p className="text-sm text-ink-700">{a.doctor?.full_name}{a.reason ? ` · ${a.reason}` : ""}</p></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Bills">
          {!invoices.data?.length ? <EmptyState title="No bills" /> : (
            <ul className="flex flex-col gap-3">
              {invoices.data.map((i) => (
                <li key={i.invoice_id} className="flex items-center justify-between gap-3">
                  <div><p className="font-mono font-bold">{i.number}</p><p className="text-sm">You owe <Money minor={Number(i.patient_due_now_minor)} currency={i.currency!} /></p></div>
                  <Badge visual={PAYMENT_VISUAL[i.payment_status as PaymentStatus]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Current medicines">
          {!meds.data?.length ? <EmptyState title="None" /> : (
            <ul className="flex flex-col gap-3">{meds.data.map((m) => <li key={m.id}><p className="font-bold">{m.drug_name}</p><p className="text-sm text-ink-700">{m.dose}, {m.frequency}</p></li>)}</ul>
          )}
        </Card>
      </div>
      <div className="mt-gutter grid gap-gutter lg:grid-cols-2">
        <Card title="Test results">
          {!results.data?.length ? <EmptyState title="No results released yet" /> : (
            <ul className="flex flex-col gap-3">{results.data.map((r) => (
              <li key={r.id}><p className="font-bold">{on.get(r.order_id) ?? "Test"}</p><p>{r.value} {r.unit} {r.reference_range ? <span className="text-ink-500">(usual range {r.reference_range})</span> : null}</p>
                <p className="text-sm text-ink-500">{r.flag === "normal" ? "Within the usual range" : "Outside the usual range. Your doctor will explain."} · <DateTimeText at={r.published_at!} timeZone={tz} />{r.version > 1 ? " · updated" : ""}</p></li>))}</ul>)}
        </Card>
        <Card title="Hospital stay summaries">
          {!summaries.data?.length ? <EmptyState title="None shared with you">Your doctor shares a summary after you leave hospital.</EmptyState> : (
            <ul className="flex flex-col gap-4">{summaries.data.map((x) => <li key={x.admission_id}><p className="text-sm text-ink-500">Shared <DateTimeText at={x.shared_at!} timeZone={tz} /></p><p className="whitespace-pre-wrap">{x.summary}</p></li>)}</ul>)}
        </Card>
      </div>
    </>
  );
}
