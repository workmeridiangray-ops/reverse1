import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { canCancelRequest, type RequestStatus } from "@/lib/rules/portal";
import { REQUEST_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { cancelRequest } from "../actions";
import { RequestForm } from "./RequestForm";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

export default async function PatientRequestPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("patient");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [requests, upcoming] = await Promise.all([
    supabase.from("appointment_requests").select("id, preferred, reason, status, decline_reason, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("appointments").select("id, starts_at, reason, doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name)").gte("starts_at", nowIso).in("status", ["scheduled", "arrived"]).order("starts_at"),
  ]);
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Appointments" description="See what's booked, or ask for a new appointment." />
      <div className="mb-gutter flex flex-col gap-3">
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
      </div>
      <div className="grid gap-gutter lg:grid-cols-2">
        <div className="flex flex-col gap-gutter">
          <Card title="Booked">
            {!upcoming.data?.length ? <EmptyState title="Nothing booked" /> : (
              <ul className="flex flex-col gap-3">
                {upcoming.data.map((a) => <li key={a.id}><p className="font-bold"><DateTimeText at={a.starts_at} timeZone={tz} /></p><p className="text-sm text-ink-700">{a.doctor?.full_name}{a.reason ? ` · ${a.reason}` : ""}</p></li>)}
              </ul>
            )}
          </Card>
          <Card title="Your requests">
            {!requests.data?.length ? <p className="text-ink-500">You haven&apos;t asked for anything yet.</p> : (
              <ul className="flex flex-col gap-4">
                {requests.data.map((r) => (
                  <li key={r.id} className="rounded border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold">{r.preferred}</p>
                      <Badge visual={REQUEST_VISUAL[r.status as RequestStatus]} size="sm" />
                    </div>
                    <p className="text-sm text-ink-700">{r.reason}</p>
                    <p className="text-caption text-ink-500">Sent <DateTimeText at={r.created_at} timeZone={tz} /></p>
                    {r.decline_reason ? <p className="mt-1 text-sm"><span className="font-bold">The clinic says: </span>{r.decline_reason}</p> : null}
                    {canCancelRequest(r.status as RequestStatus) ? (
                      <form action={cancelRequest} className="mt-2">
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" size="sm" variant="ghost">Cancel this request</Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Ask for an appointment"><RequestForm /></Card>
      </div>
    </>
  );
}
