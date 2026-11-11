import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import type { RequestStatus } from "@/lib/rules/portal";
import { REQUEST_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { declineRequest } from "./actions";

export const metadata: Metadata = { title: "Appointment requests" };
export const dynamic = "force-dynamic";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin", "receptionist");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data, error: err } = await supabase
    .from("appointment_requests")
    .select("id, preferred, reason, status, created_at, decline_reason, patient_id, patient:patients!appointment_requests_patient_id_clinic_id_fkey(given_name, family_name, mrn, phone)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (err) throw new Error(err.message);
  const open = data.filter((r) => r.status === "open").reverse();
  const closed = data.filter((r) => r.status !== "open").slice(0, 15);
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader title="Appointment requests" description={`${open.length} waiting for a reply. Patients ask from their portal; you book or decline.`} />
      <div className="mb-gutter flex flex-col gap-3">
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
      </div>
      <div className="flex flex-col gap-gutter">
        <Card title="Waiting">
          {open.length === 0 ? <EmptyState title="No requests waiting" /> : (
            <ul className="flex flex-col gap-4">
              {open.map((r) => (
                <li key={r.id} className="rounded border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold">{r.patient?.given_name} {r.patient?.family_name} <span className="font-mono text-sm font-normal text-ink-500">{r.patient?.mrn}</span></p>
                      <p><span className="font-bold">Would like: </span>{r.preferred}</p>
                      <p><span className="font-bold">For: </span>{r.reason}</p>
                      <p className="text-caption text-ink-500">Asked <DateTimeText at={r.created_at} timeZone={tz} />{r.patient?.phone ? ` · ${r.patient.phone}` : ""}</p>
                    </div>
                    <ButtonLink href={`/appointments/new?patient=${r.patient_id}&request=${r.id}`} variant="primary" size="sm" icon="plus">Book a time<span className="sr-only"> for {r.patient?.given_name}</span></ButtonLink>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-bold text-brand-700">Can&apos;t do it</summary>
                    <form action={declineRequest} className="mt-2 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={r.id} />
                      <TextField label="What should the patient be told?" name="reason" id={`decline-${r.id}`} maxLength={200} />
                      <Button type="submit" size="sm" variant="danger">Decline</Button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recently handled">
          {closed.length === 0 ? <p className="text-ink-500">Nothing yet.</p> : (
            <ul className="flex flex-col gap-3">
              {closed.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><strong>{r.patient?.given_name} {r.patient?.family_name}</strong> · {r.preferred}{r.decline_reason ? <span className="text-sm text-ink-700"> · {r.decline_reason}</span> : null}</span>
                  <Badge visual={REQUEST_VISUAL[r.status as RequestStatus]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
