import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/AppointmentForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { TextField } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { getBookingOptions } from "@/lib/data/appointments";
import { logAccess } from "@/lib/data/audit";
import { isTerminal, TRANSITION_ACTION, TRANSITIONS } from "@/lib/rules/appointment-status";
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import { formatClock, localDateKey, minutesBetween } from "@/lib/rules/time";
import { APPOINTMENT_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { setAppointmentStatus } from "../status-actions";

export const metadata: Metadata = { title: "Appointment" };
export const dynamic = "force-dynamic";

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor");
  const { id } = await params;
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("appointments")
    .select(`*, patient:patients!appointments_patient_id_clinic_id_fkey(given_name, family_name, mrn),
      doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name), room:rooms!appointments_room_id_clinic_id_fkey(name)`)
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound();
  await logAccess(supabase, "appointments", id);
  const tz = session.clinic.timezone;
  const status = a.status as AppointmentStatus;
  const canEdit = session.role !== "doctor" && status === "scheduled";
  const isOwnDoctor = session.role === "doctor" && a.doctor_id === session.userId;
  const canAct = session.role !== "doctor" || isOwnDoctor;
  const next = TRANSITIONS[status].filter((s) => s !== "cancelled" && (session.role !== "doctor" || s === "in_room" || s === "completed"));
  const opts = canEdit ? await getBookingOptions(supabase) : null;
  const back = `/appointments/${id}`;

  return (
    <>
      <PageHeader
        eyebrow="Appointment"
        title={`${a.patient?.given_name} ${a.patient?.family_name}`}
        description={<><DateTimeText at={a.starts_at} timeZone={tz} /> · {a.doctor?.full_name}</>}
        actions={<Badge visual={APPOINTMENT_VISUAL[status]} />}
      />
      {saved ? <div className="mb-gutter"><Alert tone="ok" title="Appointment saved" /></div> : null}
      {error ? <div className="mb-gutter"><Alert tone="danger" title="That didn't work">{error}</Alert></div> : null}
      <div className="grid gap-gutter lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-gutter">
          {canEdit && opts ? (
            <Card title="Reschedule or change">
              <AppointmentForm
                timeZone={tz}
                initial={{ id, patient_id: a.patient_id, doctor_id: a.doctor_id, room_id: a.room_id ?? "", date: localDateKey(new Date(a.starts_at), tz),
                  time: formatClock(new Date(a.starts_at), tz), duration: String(minutesBetween(new Date(a.starts_at), new Date(a.ends_at))), reason: a.reason ?? "" }}
                patients={opts.patients.map((p) => ({ id: p.id, label: `${p.family_name}, ${p.given_name} · ${p.mrn}` }))}
                doctors={opts.doctors.map((d) => ({ id: d.id, label: d.full_name }))}
                rooms={opts.rooms.map((r) => ({ id: r.id, label: r.out_of_service ? `${r.name} (out of service)` : r.name, disabled: r.out_of_service }))}
              />
            </Card>
          ) : (
            <Card title="Details">
              <DefinitionList items={[
                ["When", <><DateTimeText at={a.starts_at} timeZone={tz} /> – {formatClock(new Date(a.ends_at), tz)}</>],
                ["Doctor", a.doctor?.full_name ?? ""],
                ["Room", a.room?.name ?? "Not set"],
                ["Reason", a.reason ?? "None given"],
                ...(a.cancelled_reason ? [["Cancelled because", a.cancelled_reason] as [string, string]] : []),
              ]} />
              {isTerminal(status) ? <p className="mt-4 text-sm text-ink-500">This appointment is closed and can no longer be changed.</p> : null}
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-gutter">
          <Card title="Visit" as="aside">
            <DefinitionList items={[
              ["Patient", <Link key="p" href={`/patients/${a.patient_id}`}>{a.patient?.given_name} {a.patient?.family_name}</Link>],
              ["Record", <span key="m" className="font-mono">{a.patient?.mrn}</span>],
              ["Checked in", a.checked_in_at ? <DateTimeText at={a.checked_in_at} timeZone={tz} /> : "Not yet"],
              ["With doctor", a.roomed_at ? <DateTimeText at={a.roomed_at} timeZone={tz} /> : "Not yet"],
              ["Finished", a.completed_at ? <DateTimeText at={a.completed_at} timeZone={tz} /> : "Not yet"],
            ]} />
          </Card>
          {canAct && next.length ? (
            <Card title="Move visit along" as="aside">
              <div className="flex flex-wrap gap-2">
                {next.map((to) => (
                  <form key={to} action={setAppointmentStatus}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="to" value={to} />
                    <input type="hidden" name="back" value={back} />
                    <Button type="submit" size="sm" variant={to === "no_show" || to === "scheduled" ? "secondary" : "primary"}>{TRANSITION_ACTION[to]}</Button>
                  </form>
                ))}
              </div>
              {status === "arrived" && !a.room_id ? <p className="mt-3 text-sm text-ink-500">Assign a room from the front desk when sending in.</p> : null}
            </Card>
          ) : null}
          {session.role !== "doctor" && TRANSITIONS[status].includes("cancelled") ? (
            <Card title="Cancel appointment" as="aside">
              <form action={setAppointmentStatus} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="to" value="cancelled" />
                <input type="hidden" name="back" value={back} />
                <TextField label="Reason" name="reason" maxLength={200} />
                <Button type="submit" variant="danger" size="sm">Cancel appointment</Button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
