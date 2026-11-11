import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText, Money } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader, Placeholder } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import type { PaymentStatus } from "@/lib/rules/invoice";
import { LAB_FLAG_VISUAL, PAYMENT_VISUAL } from "@/lib/ui/status";
import type { ResultFlag } from "@/lib/rules/lab-flags";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My care" };
export const dynamic = "force-dynamic";

/** Everything here is filtered by RLS to the signed-in patient's own rows. */
export default async function PatientHome() {
  const session = await requireRole("patient");
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [appts, invoices, meds, results] = await Promise.all([
    supabase.from("appointments").select("id, starts_at, reason, status, doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name)")
      .gte("starts_at", nowIso).in("status", ["scheduled", "arrived"]).order("starts_at").limit(10),
    supabase.from("invoice_balances").select("invoice_id, number, patient_due_now_minor, payment_status, currency").order("created_at", { ascending: false }),
    supabase.from("prescriptions").select("id, drug_name, dose, frequency").eq("status", "active"),
    // RLS returns only results the doctor has RELEASED to this patient.
    supabase.from("lab_results").select("id, value, unit, flag, ref_low, ref_high, released_at, test:lab_test_types!lab_results_test_type_id_clinic_id_fkey(name)").order("released_at", { ascending: false }).limit(20),
  ]);
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title={`Hello, ${session.fullName.split(" ")[0]}`} />
      <div className="mb-gutter">
        <Placeholder phase="Full portal in Phase 3">Booking and messages will be added here. Test results already appear only after your doctor releases them.</Placeholder>
      </div>
      <div className="grid gap-gutter lg:grid-cols-2 xl:grid-cols-4">
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
        <Card title="Test results">
          {!results.data?.length ? <EmptyState title="No results yet">Results appear here after your doctor has reviewed and released them.</EmptyState> : (
            <ul className="flex flex-col gap-3">
              {results.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{r.test?.name}</p>
                    <p className="text-sm text-ink-700"><span className="font-mono">{r.value} {r.unit}</span>{r.ref_low !== null && r.ref_high !== null ? <> · usual range <span className="font-mono">{r.ref_low}–{r.ref_high}</span></> : null}</p>
                  </div>
                  {r.flag ? <Badge visual={LAB_FLAG_VISUAL[r.flag as ResultFlag]} size="sm" /> : null}
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
    </>
  );
}
