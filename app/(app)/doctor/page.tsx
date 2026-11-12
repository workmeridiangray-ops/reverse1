import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Clock, DateText } from "@/components/ui/Format";
import { Alert, EmptyState, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { getDoctorWorklist } from "@/lib/data/doctor";
import { CLINICAL_REVIEW_REQUIRED, type WorklistBucket } from "@/lib/rules/clinical-priority";
import { localDateKey } from "@/lib/rules/time";
import { APPOINTMENT_VISUAL, NOTE_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { setAppointmentStatus } from "../appointments/status-actions";
import { startNote } from "./actions";
import { acknowledgeResult } from "./clinical-actions";

export const metadata: Metadata = { title: "My day" };
export const dynamic = "force-dynamic";

const BUCKET_TITLE: Record<WorklistBucket, { title: string; hint: string }> = {
  critical: { title: "Critical", hint: "Flagged critical. Act on these first." },
  unsigned: { title: "Notes to sign", hint: "Unsigned notes stay here, across days, until you sign them." },
  today: { title: "Today's list", hint: "Patients in the room first, then those waiting, then by time." },
  done: { title: "Finished", hint: "" },
};

export default async function DoctorHome({ searchParams }: { searchParams: Promise<{ error?: string; signed?: string; ok?: string }> }) {
  const session = await requireRole("doctor");
  const { error, signed, ok } = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const { rows, counts } = await getDoctorWorklist(supabase, session, now);
  const { count: rangesWaiting } = await supabase.from("lab_reference_ranges").select("id", { count: "exact", head: true }).is("reviewed_at", null);
  const tz = session.clinic.timezone;
  const today = localDateKey(now, tz);
  const buckets = (Object.keys(BUCKET_TITLE) as WorklistBucket[])
    .map((b) => ({ bucket: b, rows: rows.filter((r) => r.bucket === b) }))
    .filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(now)}
        title={`Your day, ${session.fullName.replace(/^Dr\.?\s*/, "Dr ")}`}
        description={
          <>
            {counts.patientsToday} patients today · {counts.waiting} waiting now ·{" "}
            <strong className={counts.unsigned ? "text-warn-fg" : ""}>{counts.unsigned} notes to sign</strong>
            {counts.critical ? <> · <strong className="text-danger-fg">{counts.critical} critical</strong></> : null}
          </>
        }
      />
      {error ? <div className="mb-gutter"><Alert tone="danger" title="That didn't work">{error}</Alert></div> : null}
      {ok ? <div className="mb-gutter"><Alert tone="ok" title={ok} /></div> : null}
      {(rangesWaiting ?? 0) > 0 ? (
        <div className="mb-gutter"><Alert tone="warn" title={`${rangesWaiting} lab reference range${rangesWaiting === 1 ? "" : "s"} waiting for your sign-off`}><Link href="/doctor/ranges">Review them</Link></Alert></div>
      ) : null}
      {signed ? <div className="mb-gutter"><Alert tone="ok" title="Note signed">It is now locked. Corrections will be added as addenda.</Alert></div> : null}
      {CLINICAL_REVIEW_REQUIRED ? (
        <p className="mb-gutter text-sm text-ink-500">
          Ordering is an engineering default awaiting clinician review. Critical lab limits come from reference ranges that also await review.
        </p>
      ) : null}

      {rows.length === 0 ? <EmptyState title="Nothing on your list today" /> : null}

      <div className="flex flex-col gap-section">
        {buckets.map(({ bucket, rows: items }) => (
          <section key={bucket} aria-labelledby={`b-${bucket}`}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 id={`b-${bucket}`} className="text-heading font-bold">
                {BUCKET_TITLE[bucket].title} <span className="font-mono text-title font-normal text-ink-500">{items.length}</span>
              </h2>
              <p className="text-sm text-ink-500">{BUCKET_TITLE[bucket].hint}</p>
            </div>
            <ul className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
              {items.map((r) => {
                const key = r.labResultId ?? r.consultationId ?? r.appointmentId ?? r.patientId;
                const accent = r.critical ? "shadow-[inset_5px_0_0_theme(colors.critical.bg)]" : r.unsignedNote ? "shadow-[inset_5px_0_0_theme(colors.warn.line)]" : "";
                return (
                  <li key={key} className={`grid gap-4 border-b border-line px-6 py-4 last:border-b-0 md:grid-cols-[6rem_1fr_auto_auto] md:items-center ${accent}`}>
                    <div>
                      {r.carriedOver ? (
                        <p className="text-sm font-bold text-ink-700">{r.startsAt ? <DateText at={r.startsAt} timeZone={tz} /> : "Earlier"}</p>
                      ) : r.startsAt ? <Clock at={r.startsAt} timeZone={tz} className="text-lg" /> : null}
                    </div>
                    <div>
                      <Link href={`/patients/${r.patientId}`} className="text-lg font-bold text-ink-900">{r.patientName}</Link>
                      <p className="text-sm text-ink-500">
                        {r.reason ?? "No reason given"}{r.roomName ? ` · ${r.roomName}` : ""}
                      </p>
                      {r.critical && r.criticalReason ? <p className="mt-1 font-bold text-danger-fg">{r.criticalReason}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {r.critical ? <Badge visual={NOTE_VISUAL.critical} size="sm" /> : null}
                      {r.unsignedNote ? <Badge visual={NOTE_VISUAL.unsigned} size="sm" /> : r.noteSigned ? <Badge visual={NOTE_VISUAL.signed} size="sm" /> : null}
                      {r.appointmentStatus && !r.carriedOver ? <Badge visual={APPOINTMENT_VISUAL[r.appointmentStatus]} size="sm" /> : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {!r.carriedOver && r.appointmentId && r.appointmentStatus === "arrived" ? (
                        <form action={setAppointmentStatus}>
                          <input type="hidden" name="id" value={r.appointmentId} />
                          <input type="hidden" name="to" value="in_room" />
                          <input type="hidden" name="back" value="/doctor" />
                          <Button type="submit" size="sm" variant="secondary">Call in</Button>
                        </form>
                      ) : null}
                      {!r.carriedOver && r.appointmentId && r.appointmentStatus === "in_room" ? (
                        <form action={setAppointmentStatus}>
                          <input type="hidden" name="id" value={r.appointmentId} />
                          <input type="hidden" name="to" value="completed" />
                          <input type="hidden" name="back" value="/doctor" />
                          <Button type="submit" size="sm" variant="secondary">Finish visit</Button>
                        </form>
                      ) : null}
                      {r.labResultId ? (
                        <>
                          {r.openConsultationId ? (
                            <Link href={`/doctor/notes/${r.openConsultationId}`} className="inline-flex min-h-touch items-center px-2 text-sm font-bold">Open note</Link>
                          ) : null}
                          <form action={acknowledgeResult}>
                            <input type="hidden" name="id" value={r.labResultId} /><input type="hidden" name="back" value="/doctor" />
                            <Button type="submit" size="sm" variant="primary">Acknowledge<span className="sr-only"> result for {r.patientName}</span></Button>
                          </form>
                        </>
                      ) : r.consultationId ? (
                        <Link href={`/doctor/notes/${r.consultationId}`} className="inline-flex min-h-touch items-center rounded border border-brand-700 bg-brand-700 px-3 text-sm font-bold text-white no-underline hover:bg-brand-800">
                          {r.unsignedNote ? "Continue note" : "View note"}<span className="sr-only"> for {r.patientName}</span>
                        </Link>
                      ) : r.appointmentId && r.appointmentStatus !== "cancelled" && r.appointmentStatus !== "no_show" ? (
                        <form action={startNote}>
                          <input type="hidden" name="appointment_id" value={r.appointmentId} />
                          <Button type="submit" size="sm" variant="primary">Start note<span className="sr-only"> for {r.patientName}</span></Button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-section text-sm text-ink-500">Showing {today} in {tz}.</p>
    </>
  );
}
