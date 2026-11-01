import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Clock, Money } from "@/components/ui/Format";
import { Icon } from "@/components/ui/Icon";
import { Alert, EmptyState, PageHeader } from "@/components/ui/Layout";
import { LiveRefresh } from "@/components/reception/LiveRefresh";
import { requireRole } from "@/lib/auth/session";
import { getReceptionBoard, type ReceptionBoardData } from "@/lib/data/reception";
import { TRANSITION_ACTION } from "@/lib/rules/appointment-status";
import { patientOwesNow } from "@/lib/rules/invoice";
import type { BoardGroup } from "@/lib/rules/reception";
import { APPOINTMENT_VISUAL, CONSENT_VISUAL, PAYMENT_VISUAL, ROOM_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { setAppointmentStatus } from "../appointments/status-actions";

export const metadata: Metadata = { title: "Front desk" };
export const dynamic = "force-dynamic";

const GROUP_TITLE: Record<BoardGroup, string> = {
  waiting: "Here and waiting",
  with_doctor: "With a doctor",
  expected: "Still expected",
  finished: "Finished",
  not_coming: "Cancelled or no-show",
};

type Row = ReceptionBoardData["rows"][number];

export default async function ReceptionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireRole("receptionist", "admin");
  const { error } = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const board = await getReceptionBoard(supabase, session, now);
  const tz = session.clinic.timezone;
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(now);
  const groups = (Object.keys(GROUP_TITLE) as BoardGroup[])
    .map((g) => ({ group: g, rows: board.rows.filter((r) => r.group === g) }))
    .filter((g) => g.rows.length > 0);
  const next = board.summary.next;

  return (
    <>
      <PageHeader
        eyebrow={dateLabel}
        title="Who's here, who's next"
        description={<LiveRefresh clinicId={session.clinic.id} />}
        actions={
          <>
            <ButtonLink href="/patients/new" icon="plus">New patient</ButtonLink>
            <ButtonLink href="/appointments/new" variant="primary" icon="plus">Book appointment</ButtonLink>
          </>
        }
      />

      {error ? <div className="mb-gutter"><Alert tone="danger" title="That didn't work">{error}</Alert></div> : null}

      {/* Answer first: who is next, then the numbers. */}
      <section aria-labelledby="summary-title" className="mb-section grid gap-gutter md:grid-cols-[2fr_1fr_1fr_1fr]">
        <h2 id="summary-title" className="sr-only">Summary</h2>
        <div className="rounded-lg border-2 border-brand-700 bg-surface p-5 shadow-card">
          <p className="text-sm font-bold uppercase tracking-wide text-brand-700">Next</p>
          {next ? (
            <>
              <p className="mt-1 text-heading font-bold">{next.patientName}</p>
              <p className="text-ink-700">
                {next.group === "waiting"
                  ? <>Waiting {next.waitingMinutes ?? 0} min for {next.doctorName}</>
                  : <>Expected <Clock at={next.startsAt} timeZone={tz} /> with {next.doctorName}</>}
              </p>
            </>
          ) : (
            <p className="mt-1 text-lg text-ink-700">Nobody else is expected today.</p>
          )}
        </div>
        <Stat label="Here now" value={board.summary.here} detail={`${board.summary.waiting} waiting · ${board.summary.withDoctor} with doctor`} />
        <Stat label="Still expected" value={board.summary.expectedRemaining} detail={board.summary.late ? `${board.summary.late} running late` : "None late"} tone={board.summary.late ? "warn" : undefined} />
        <Stat label="Owes at checkout" value={board.summary.owesAtCheckout} detail={board.summary.owesAtCheckout ? "Stop at the desk" : "Nobody leaving unpaid"} tone={board.summary.owesAtCheckout ? "danger" : undefined} />
      </section>

      <div className="grid gap-gutter xl:grid-cols-[1fr_20rem]">
        <section aria-labelledby="today-title" className="rounded-lg border border-line bg-surface shadow-card">
          <h2 id="today-title" className="border-b border-line px-6 py-4 text-title font-bold">Today</h2>
          {board.rows.length === 0 ? (
            <div className="p-6"><EmptyState title="No appointments today">Book one to see it here.</EmptyState></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Today&apos;s appointments, grouped by where each patient is. Payment state is on the same row.</caption>
                <thead>
                  <tr className="text-caption font-bold uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-4 py-2">Time</th>
                    <th scope="col" className="px-4 py-2">Patient</th>
                    <th scope="col" className="px-4 py-2">Doctor · room</th>
                    <th scope="col" className="px-4 py-2">Where</th>
                    <th scope="col" className="px-4 py-2">Payment</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                {groups.map(({ group, rows }) => (
                  <tbody key={group}>
                    <tr>
                      <th scope="rowgroup" colSpan={6} className="border-y border-line bg-sunken px-4 py-2 text-sm font-bold text-ink-700">
                        {GROUP_TITLE[group]} <span className="font-normal text-ink-500">({rows.length})</span>
                      </th>
                    </tr>
                    {rows.map((r) => <BoardRow key={r.id} row={r} tz={tz} currency={session.clinic.currency} freeRooms={board.freeRooms} />)}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="rooms-title" className="self-start rounded-lg border border-line bg-surface shadow-card">
          <h2 id="rooms-title" className="border-b border-line px-6 py-4 text-title font-bold">Rooms</h2>
          <ul className="divide-y divide-line">
            {board.rooms.map((room) => (
              <li key={room.id} className="flex items-start justify-between gap-3 px-6 py-4">
                <div>
                  <p className="font-bold">{room.name}</p>
                  <p className="text-sm text-ink-500">
                    {room.occupantName
                      ? <>With {room.occupantName}</>
                      : room.nextAt
                        ? <>Next <Clock at={room.nextAt} timeZone={tz} /> · {room.nextPatientName}</>
                        : room.state === "out_of_service" ? "Not available today" : "Nothing booked"}
                  </p>
                </div>
                <Badge visual={ROOM_VISUAL[room.state]} size="sm" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: "warn" | "danger" }) {
  const accent = tone === "danger" ? "border-l-danger-fg" : tone === "warn" ? "border-l-warn-fg" : "border-l-line-strong";
  return (
    <div className={`rounded-lg border border-line border-l-4 ${accent} bg-surface p-5 shadow-card`}>
      <p className="text-sm font-bold text-ink-500">{label}</p>
      <p className="font-mono text-display font-medium">{value}</p>
      <p className="text-sm text-ink-700">{detail}</p>
    </div>
  );
}

function BoardRow({ row, tz, currency, freeRooms }: { row: Row; tz: string; currency: string; freeRooms: ReceptionBoardData["freeRooms"] }) {
  const detail =
    row.waitingMinutes !== null ? `${row.waitingMinutes} min` : row.lateMinutes !== null ? `${row.lateMinutes} min late` : undefined;
  return (
    <tr className={`border-b border-line ${row.isNext ? "bg-brand-50 shadow-[inset_4px_0_0_theme(colors.brand.700)]" : ""}`}>
      <td className="px-4 py-3 align-top">
        <Clock at={row.startsAt} timeZone={tz} className="text-lg" />
        {row.isNext ? <p className="text-caption font-bold uppercase text-brand-700">Next</p> : null}
      </td>
      <td className="px-4 py-3 align-top">
        <Link href={`/patients/${row.patientId}`} className="font-bold text-ink-900">{row.patientName}</Link>
        {row.reason ? <p className="text-sm text-ink-500">{row.reason}</p> : null}
        {row.consentMissing ? <div className="mt-1"><Badge visual={CONSENT_VISUAL.missing} size="sm" /></div> : null}
      </td>
      <td className="px-4 py-3 align-top text-sm">
        <p>{row.doctorName}</p>
        <p className="text-ink-500">{row.roomName ?? "No room yet"}</p>
      </td>
      <td className="px-4 py-3 align-top">
        <Badge
          visual={row.lateMinutes !== null ? { tone: "warn", icon: "clock", label: "Late" } : APPOINTMENT_VISUAL[row.status]}
          detail={detail}
          size="sm"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <Badge visual={PAYMENT_VISUAL[row.paymentStatus ?? "none"]} size="sm" />
        {row.paymentStatus && patientOwesNow(row.paymentStatus) ? (
          <p className="mt-1 text-sm font-bold text-danger-fg">Due <Money minor={row.patientDueNowMinor} currency={currency} /></p>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top">
        <RowActions row={row} freeRooms={freeRooms} />
      </td>
    </tr>
  );
}

function StatusForm({ id, to, children, variant = "secondary", extra }: { id: string; to: string; children: string; variant?: "primary" | "secondary" | "ghost"; extra?: React.ReactNode }) {
  return (
    <form action={setAppointmentStatus} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="back" value="/reception" />
      {extra}
      <Button type="submit" size="sm" variant={variant}>{children}</Button>
    </form>
  );
}

function RowActions({ row, freeRooms }: { row: Row; freeRooms: ReceptionBoardData["freeRooms"] }) {
  const actions: React.ReactNode[] = [];
  const label = `for ${row.patientName}`;
  if (row.status === "scheduled") {
    actions.push(<StatusForm key="in" id={row.id} to="arrived" variant="primary">{TRANSITION_ACTION.arrived}</StatusForm>);
    if (row.lateMinutes !== null) actions.push(<StatusForm key="ns" id={row.id} to="no_show" variant="ghost">{TRANSITION_ACTION.no_show}</StatusForm>);
  }
  if (row.status === "arrived") {
    const roomSelect = row.roomId ? null : (
      <>
        <label htmlFor={`room-${row.id}`} className="sr-only">Room {label}</label>
        <select id={`room-${row.id}`} name="room_id" required className="min-h-touch rounded border border-ink-500 bg-surface px-2 text-sm">
          <option value="">Room…</option>
          {freeRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </>
    );
    actions.push(<StatusForm key="room" id={row.id} to="in_room" variant="primary" extra={roomSelect}>{TRANSITION_ACTION.in_room}</StatusForm>);
    actions.push(<StatusForm key="undo" id={row.id} to="scheduled" variant="ghost">Undo</StatusForm>);
  }
  if (row.status === "in_room") actions.push(<StatusForm key="done" id={row.id} to="completed">{TRANSITION_ACTION.completed}</StatusForm>);
  if (row.status === "completed" || row.status === "in_room") {
    actions.push(
      row.invoiceId ? (
        <ButtonLink key="inv" href={`/billing/${row.invoiceId}`} size="sm" variant={row.owesAtCheckout ? "primary" : "ghost"}>
          {row.owesAtCheckout ? "Take payment" : "Invoice"}
        </ButtonLink>
      ) : (
        <ButtonLink key="inv" href={`/billing/new?patient=${row.patientId}&appointment=${row.id}`} size="sm" variant="ghost" icon="plus">Invoice</ButtonLink>
      ),
    );
  }
  if (actions.length === 0) return <Link href={`/appointments/${row.id}`} className="text-sm">Details <Icon name="arrow-right" className="inline h-3.5 w-3.5" /></Link>;
  return <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>;
}
