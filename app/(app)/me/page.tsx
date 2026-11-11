import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateText, DateTimeText, Money } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, EmptyState, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { getAllergies } from "@/lib/data/clinical";
import type { PaymentStatus } from "@/lib/rules/invoice";
import type { ResultFlag } from "@/lib/rules/lab-flags";
import { consentState } from "@/lib/rules/patient";
import { APPOINTMENT_VISUAL, CONSENT_VISUAL, LAB_FLAG_VISUAL, PAYMENT_VISUAL } from "@/lib/ui/status";
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My care" };
export const dynamic = "force-dynamic";

/** Everything here is filtered by row-level security to the signed-in patient's own rows. */
export default async function PatientHome({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const session = await requireRole("patient");
  const { ok } = await searchParams;
  const supabase = await createClient();
  const { data: me } = await supabase.from("patients").select("id, given_name, mrn, phone, email, address, consent_communication, consent_treatment_at, consent_data_processing_at, consent_version").maybeSingle();
  if (!me) notFound();
  await logAccess(supabase, "patients", me.id, "patient portal");
  const nowIso = new Date().toISOString();
  const [upcoming, past, bills, meds, dispenses, results, allergies, openRequests] = await Promise.all([
    supabase.from("appointments").select("id, starts_at, reason, status, doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name)").gte("starts_at", nowIso).in("status", ["scheduled", "arrived"]).order("starts_at").limit(5),
    supabase.from("appointments").select("id, starts_at, reason, status, doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name)").lt("starts_at", nowIso).order("starts_at", { ascending: false }).limit(5),
    supabase.from("invoice_balances").select("invoice_id, number, patient_due_now_minor, total_minor, payment_status, currency").order("created_at", { ascending: false }).limit(10),
    supabase.from("prescriptions").select("id, drug_name, dose, route, frequency, duration_days, status").in("status", ["active", "dispensed"]).order("created_at", { ascending: false }).limit(10),
    supabase.from("dispenses").select("prescription_id, dispensed_at, quantity"),
    // RLS returns only results the doctor has RELEASED to this patient.
    supabase.from("lab_results").select("id, value, unit, flag, ref_low, ref_high, released_at, test:lab_test_types!lab_results_test_type_id_clinic_id_fkey(name)").order("released_at", { ascending: false }).limit(20),
    getAllergies(supabase, me.id),
    supabase.from("appointment_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  const tz = session.clinic.timezone;
  const dispensedBy = new Map((dispenses.data ?? []).map((d) => [d.prescription_id, d]));
  const consent = consentState(
    { consentTreatmentAt: me.consent_treatment_at, consentDataProcessingAt: me.consent_data_processing_at, consentCommunication: me.consent_communication, consentVersion: me.consent_version },
    session.clinic.consentVersion,
  );
  const owing = (bills.data ?? []).filter((b) => Number(b.patient_due_now_minor) > 0);

  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title={`Hello, ${session.fullName.split(" ")[0]}`}
        description="Your appointments, results, medicines and bills in one place. Only you and your care team can see this."
        actions={<ButtonLink href="/me/request" variant="primary" icon="plus">Ask for an appointment</ButtonLink>} />
      <div className="mb-gutter flex flex-col gap-3">
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {owing.length > 0 ? <Alert tone="warn" title={`You have ${owing.length} bill${owing.length > 1 ? "s" : ""} to pay`}>Please settle at the front desk next time you visit.</Alert> : null}
        {(openRequests.count ?? 0) > 0 ? <Alert tone="info" title="The clinic is looking at your appointment request"><Link href="/me/request">See your requests</Link></Alert> : null}
      </div>
      <div className="grid gap-gutter lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Coming up">
          {!upcoming.data?.length ? <EmptyState title="Nothing booked"><Link href="/me/request">Ask for an appointment</Link></EmptyState> : (
            <ul className="flex flex-col gap-3">
              {upcoming.data.map((a) => <li key={a.id}><p className="font-bold"><DateTimeText at={a.starts_at} timeZone={tz} /></p><p className="text-sm text-ink-700">{a.doctor?.full_name}{a.reason ? ` · ${a.reason}` : ""}</p></li>)}
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
        <Card title="Medicines">
          {!meds.data?.length ? <EmptyState title="None" /> : (
            <ul className="flex flex-col gap-3">
              {meds.data.map((m) => {
                const d = dispensedBy.get(m.id);
                return (
                  <li key={m.id}>
                    <p className="font-bold">{m.drug_name}</p>
                    <p className="text-sm text-ink-700">{m.dose}, {m.route}, {m.frequency}{m.duration_days ? `, ${m.duration_days} days` : ""}</p>
                    <p className="mt-1">{d ? <Badge visual={{ tone: "ok", icon: "check", label: "Collected" }} size="sm" detail={`${d.quantity} on `} /> : <Badge visual={{ tone: "info", icon: "hourglass", label: "Ready for the pharmacy" }} size="sm" />}{d ? <span className="ml-2 text-sm text-ink-700"><DateText at={d.dispensed_at} timeZone={tz} /></span> : null}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="Allergies on your record">
          {allergies.length === 0 ? <p className="text-ink-700">Nothing recorded yet. Tell your doctor about any allergies.</p> : (
            <ul className="flex flex-col gap-2">
              {allergies.map((a) => <li key={a.id}>{a.kind === "nkda" ? <span className="font-bold">No known drug allergies</span> : <><strong>{a.allergen}</strong>{a.reaction ? <span className="text-sm text-ink-700"> · {a.reaction}</span> : null}</>}</li>)}
            </ul>
          )}
        </Card>
        <Card title="Bills">
          {!bills.data?.length ? <EmptyState title="No bills" /> : (
            <ul className="flex flex-col gap-3">
              {bills.data.map((i) => (
                <li key={i.invoice_id} className="flex items-center justify-between gap-3">
                  <div><p className="font-mono font-bold">{i.number}</p><p className="text-sm">Total <Money minor={Number(i.total_minor)} currency={i.currency!} /> · you owe <Money minor={Number(i.patient_due_now_minor)} currency={i.currency!} /></p></div>
                  <Badge visual={PAYMENT_VISUAL[i.payment_status as PaymentStatus]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="My details" actions={<Link href="/me/details">Update</Link>}>
          <DefinitionList items={[
            ["Phone", me.phone ?? "None"], ["Email", me.email ?? "None"], ["Address", me.address ?? "None"],
            ["Reminders", me.consent_communication ? "Yes" : "No"],
            ["Consent", <Badge key="c" visual={CONSENT_VISUAL[consent]} size="sm" />],
          ]} />
        </Card>
        <Card title="Past visits">
          {!past.data?.length ? <EmptyState title="No past visits" /> : (
            <ul className="flex flex-col gap-3">
              {past.data.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="font-bold"><DateText at={a.starts_at} timeZone={tz} /></p><p className="text-sm text-ink-700">{a.doctor?.full_name}{a.reason ? ` · ${a.reason}` : ""}</p></div>
                  <Badge visual={APPOINTMENT_VISUAL[a.status as AppointmentStatus]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
