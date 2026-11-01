import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Clock } from "@/components/ui/Format";
import { EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getDayAppointments } from "@/lib/data/reception";
import { localDateKey, parseDateKey } from "@/lib/rules/time";
import { APPOINTMENT_VISUAL, PAYMENT_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

function shift(dateKey: string, days: number): string {
  const d = parseDateKey(dateKey);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return t.toISOString().slice(0, 10);
}

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string; mine?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor");
  const sp = await searchParams;
  const tz = session.clinic.timezone;
  const today = localDateKey(new Date(), tz);
  let date = today;
  try { if (sp.date) { parseDateKey(sp.date); date = sp.date; } } catch { /* fall back to today */ }
  const mine = session.role === "doctor" && sp.mine !== "0";
  const supabase = await createClient();
  const rows = await getDayAppointments(supabase, session, date, mine ? { doctorId: session.userId } : {});
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  const showPayment = session.role !== "doctor";
  const q = (d: string) => `/appointments?date=${d}${session.role === "doctor" && !mine ? "&mine=0" : ""}`;

  return (
    <>
      <PageHeader
        eyebrow={date === today ? "Today" : "Schedule"}
        title={label}
        actions={session.role !== "doctor" ? <ButtonLink href={`/appointments/new?date=${date}`} variant="primary" icon="plus">Book appointment</ButtonLink> : null}
      />
      <nav aria-label="Change day" className="mb-gutter flex flex-wrap items-center gap-3">
        <ButtonLink href={q(shift(date, -1))} icon="chevron-left" size="sm">Previous day</ButtonLink>
        {date !== today ? <ButtonLink href={q(today)} size="sm">Today</ButtonLink> : null}
        <ButtonLink href={q(shift(date, 1))} size="sm">Next day</ButtonLink>
        <form action="/appointments" className="flex items-center gap-2">
          <label htmlFor="date" className="text-sm font-bold">Go to</label>
          <input id="date" name="date" type="date" defaultValue={date} className="min-h-touch rounded border border-ink-500 bg-surface px-2" />
          {session.role === "doctor" && !mine ? <input type="hidden" name="mine" value="0" /> : null}
          <button type="submit" className="min-h-touch rounded border border-ink-500 bg-surface px-3 text-sm font-bold">Go</button>
        </form>
        {session.role === "doctor" ? (
          <Link href={`/appointments?date=${date}${mine ? "&mine=0" : ""}`} className="ml-auto text-sm font-bold">
            {mine ? "Show all doctors" : "Show only mine"}
          </Link>
        ) : null}
      </nav>
      {rows.length === 0 ? <EmptyState title="No appointments on this day" /> : (
        <div className="rounded-lg border border-line bg-surface p-2 shadow-card">
          <Table caption={`Appointments on ${label}`}>
            <thead><tr><Th>Time</Th><Th>Patient</Th><Th>Doctor</Th><Th>Room</Th><Th>Status</Th>{showPayment ? <Th>Payment</Th> : null}</tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-canvas">
                  <Td><Link href={`/appointments/${a.id}`}><Clock at={a.startsAt} timeZone={tz} />–<Clock at={a.endsAt} timeZone={tz} /></Link></Td>
                  <Td><Link href={`/patients/${a.patientId}`} className="font-bold text-ink-900">{a.patientName}</Link>{a.reason ? <p className="text-sm text-ink-500">{a.reason}</p> : null}</Td>
                  <Td>{a.doctorName}</Td>
                  <Td>{a.roomName ?? <span className="text-ink-500">Not set</span>}</Td>
                  <Td><Badge visual={APPOINTMENT_VISUAL[a.status]} size="sm" /></Td>
                  {showPayment ? <Td><Badge visual={PAYMENT_VISUAL[a.paymentStatus ?? "none"]} size="sm" /></Td> : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
