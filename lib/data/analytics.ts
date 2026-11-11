import "server-only";
import type { Session } from "@/lib/auth/session";
import { collectionRate, type DurationSummary, summarizeDurations, type Proportion, proportion } from "@/lib/rules/analytics";
import { sum } from "@/lib/rules/money";
import type { ServerClient } from "@/lib/supabase/server";

const minutes = (a: string | null, b: string | null): number | null => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 60_000 : null);

export interface Analytics {
  days: number;
  from: Date;
  to: Date;
  wait: DurationSummary;
  visit: DurationSummary;
  waitByDoctor: Array<{ doctor: string; summary: DurationSummary }>;
  noShow: Proportion;
  cancelled: number;
  collection: Proportion;
  invoiceCount: number;
  awaitingInsurer: { count: number; minor: number };
  labTurnaround: DurationSummary;
  criticalAck: DurationSummary;
  criticalOpen: number;
  currency: string;
}

/**
 * Everything is computed from rows the administrator is already allowed to
 * read (appointments, invoices) plus bare durations from a function that
 * returns no patient information (lab timings).
 */
export async function getAnalytics(supabase: ServerClient, session: Session, days: number, now: Date): Promise<Analytics> {
  const from = new Date(now.getTime() - days * 86_400_000);
  const [appts, invoices, pending, lab] = await Promise.all([
    supabase.from("appointments").select("status, checked_in_at, roomed_at, completed_at, doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name)")
      .gte("starts_at", from.toISOString()).lt("starts_at", now.toISOString()).limit(5000),
    supabase.from("invoice_balances").select("patient_responsibility_minor, patient_paid_minor").eq("state", "issued")
      .gte("issued_at", from.toISOString()).lt("issued_at", now.toISOString()).limit(5000),
    supabase.from("invoice_balances").select("insurance_claimed_minor").eq("state", "issued").eq("insurance_status", "pending"),
    supabase.rpc("analytics_lab_durations", { p_from: from.toISOString(), p_to: now.toISOString() }),
  ]);
  for (const r of [appts, invoices, pending, lab]) if (r.error) throw new Error(r.error.message);
  const apptRows = appts.data ?? [];
  const invoiceRows = invoices.data ?? [];
  const pendingRows = pending.data ?? [];

  // A wait only exists for visits that reached the doctor; a visit length only for completed ones.
  const reachedDoctor = apptRows.filter((a) => a.status === "in_room" || a.status === "completed");
  const wait = summarizeDurations(reachedDoctor.map((a) => minutes(a.checked_in_at, a.roomed_at)));
  const visit = summarizeDurations(apptRows.filter((a) => a.status === "completed").map((a) => minutes(a.roomed_at, a.completed_at)));

  const byDoctor = new Map<string, Array<number | null>>();
  for (const a of reachedDoctor) {
    const name = a.doctor?.full_name ?? "Unknown";
    byDoctor.set(name, [...(byDoctor.get(name) ?? []), minutes(a.checked_in_at, a.roomed_at)]);
  }
  const completed = apptRows.filter((a) => a.status === "completed").length;
  const noShows = apptRows.filter((a) => a.status === "no_show").length;

  const labRows = lab.data ?? [];
  const of = (kind: string) => labRows.filter((r) => r.kind === kind).map((r) => Number(r.minutes));
  return {
    days, from, to: now, wait, visit,
    waitByDoctor: [...byDoctor.entries()].map(([doctor, v]) => ({ doctor, summary: summarizeDurations(v) })).sort((a, b) => a.doctor.localeCompare(b.doctor)),
    noShow: proportion(noShows, noShows + completed),
    cancelled: apptRows.filter((a) => a.status === "cancelled").length,
    collection: collectionRate(invoiceRows.map((i) => ({ responsibilityMinor: Number(i.patient_responsibility_minor), paidMinor: Number(i.patient_paid_minor) }))),
    invoiceCount: invoiceRows.length,
    awaitingInsurer: { count: pendingRows.length, minor: sum(pendingRows.map((p) => Number(p.insurance_claimed_minor))) },
    labTurnaround: summarizeDurations(of("lab_turnaround")),
    criticalAck: summarizeDurations(of("critical_acknowledged")),
    criticalOpen: of("critical_open").length,
    currency: session.clinic.currency,
  };
}
