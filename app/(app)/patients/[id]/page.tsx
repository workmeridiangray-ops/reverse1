import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateText, DateTimeText, Money } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import type { PaymentStatus } from "@/lib/rules/invoice";
import { consentState } from "@/lib/rules/patient";
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import { ageInYears } from "@/lib/rules/time";
import { APPOINTMENT_VISUAL, CONSENT_VISUAL, PAYMENT_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Patient" };
export const dynamic = "force-dynamic";

export default async function PatientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor");
  const { id } = await params;
  const { saved } = await searchParams;
  const supabase = await createClient();
  const { data: p } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  await logAccess(supabase, "patients", id);

  const canBill = session.role === "admin" || session.role === "receptionist";
  const [appts, invoices] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, starts_at, status, reason, doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name)")
      .eq("patient_id", id)
      .order("starts_at", { ascending: false })
      .limit(50),
    canBill
      ? supabase.from("invoice_balances").select("invoice_id, number, created_at, total_minor, patient_due_now_minor, payment_status, currency").eq("patient_id", id).order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);
  const tz = session.clinic.timezone;
  const consent = consentState(
    { consentTreatmentAt: p.consent_treatment_at, consentDataProcessingAt: p.consent_data_processing_at, consentCommunication: p.consent_communication, consentVersion: p.consent_version },
    session.clinic.consentVersion,
  );
  const now = Date.now();
  const upcoming = (appts.data ?? []).filter((a) => new Date(a.starts_at).getTime() >= now).reverse();
  const past = (appts.data ?? []).filter((a) => new Date(a.starts_at).getTime() < now);

  return (
    <>
      <PageHeader
        eyebrow={`Patient · ${p.mrn}`}
        title={`${p.given_name} ${p.family_name}`}
        description={<>{ageInYears(p.date_of_birth, new Date(), tz)} years · born <DateText at={`${p.date_of_birth}T12:00:00Z`} timeZone="UTC" /> · {p.sex_at_birth}</>}
        actions={
          canBill ? (
            <>
              <ButtonLink href={`/patients/${id}/edit`} icon="pencil">Edit</ButtonLink>
              <ButtonLink href={`/billing/new?patient=${id}`} icon="plus">Invoice</ButtonLink>
              <ButtonLink href={`/appointments/new?patient=${id}`} variant="primary" icon="plus">Book appointment</ButtonLink>
            </>
          ) : null
        }
      />
      {saved ? <div className="mb-gutter"><Alert tone="ok" title="Patient saved" /></div> : null}
      <div className="grid gap-gutter lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-gutter">
          <Card title="Upcoming">
            {upcoming.length === 0 ? <EmptyState title="Nothing booked" /> : <ApptTable rows={upcoming} tz={tz} />}
          </Card>
          <Card title="Past visits">
            {past.length === 0 ? <EmptyState title="No past visits" /> : <ApptTable rows={past} tz={tz} />}
          </Card>
          {invoices.data ? (
            <Card title="Invoices">
              {invoices.data.length === 0 ? <EmptyState title="No invoices" /> : (
                <Table caption="Invoices for this patient">
                  <thead><tr><Th>Number</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Owed now</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {invoices.data.map((i) => (
                      <tr key={i.invoice_id}>
                        <Td><Link href={`/billing/${i.invoice_id}`} className="font-mono">{i.number}</Link></Td>
                        <Td><DateText at={i.created_at!} timeZone={tz} /></Td>
                        <Td className="text-right"><Money minor={Number(i.total_minor)} currency={i.currency!} /></Td>
                        <Td className="text-right"><Money minor={Number(i.patient_due_now_minor)} currency={i.currency!} /></Td>
                        <Td><Badge visual={PAYMENT_VISUAL[i.payment_status as PaymentStatus]} size="sm" /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          ) : null}
        </div>
        <div className="flex flex-col gap-gutter">
          <Card title="Contact" as="aside">
            <DefinitionList items={[["Phone", p.phone ?? "None"], ["Email", p.email ?? "None"], ["Address", p.address ?? "None"]]} />
          </Card>
          <Card title="Consent" as="aside" actions={<Badge visual={CONSENT_VISUAL[consent]} size="sm" />}>
            <DefinitionList
              items={[
                ["Treatment", p.consent_treatment_at ? <DateTimeText at={p.consent_treatment_at} timeZone={tz} /> : "Not given"],
                ["Health data", p.consent_data_processing_at ? <DateTimeText at={p.consent_data_processing_at} timeZone={tz} /> : "Not given"],
                ["Reminders", p.consent_communication ? "Yes" : "No"],
                ["Form version", p.consent_version ?? "None"],
              ]}
            />
            {consent !== "complete" && canBill ? <p className="mt-4"><Link href={`/patients/${id}/edit`}>Record consent</Link></p> : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function ApptTable({ rows, tz }: { rows: Array<{ id: string; starts_at: string; status: string; reason: string | null; doctor: { full_name: string } | null }>; tz: string }) {
  return (
    <Table caption="Appointments">
      <thead><tr><Th>When</Th><Th>Doctor</Th><Th>Reason</Th><Th>Status</Th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <Td><Link href={`/appointments/${a.id}`}><DateTimeText at={a.starts_at} timeZone={tz} /></Link></Td>
            <Td>{a.doctor?.full_name}</Td>
            <Td className="text-sm">{a.reason ?? "None given"}</Td>
            <Td><Badge visual={APPOINTMENT_VISUAL[a.status as AppointmentStatus]} size="sm" /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
