import type { Metadata } from "next";
import Link from "next/link";
import { LiveRefresh } from "@/components/reception/LiveRefresh";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { getCensus, listAdmissions } from "@/lib/data/inpatient";
import { BED_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { setHousekeeping } from "../admissions/actions";

export const metadata: Metadata = { title: "Ward census" };
export const dynamic = "force-dynamic";
const LIVE = ["beds", "admissions", "bed_stays"];

export default async function Wards({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor", "nurse");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const [census, waiting] = await Promise.all([getCensus(supabase), listAdmissions(supabase, ["requested"], 50)]);
  const canClean = session.role === "admin" || session.role === "nurse";
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Ward census" description={<LiveRefresh clinicId={session.clinic.id} tables={LIVE} />}
        actions={<>
          {session.role !== "nurse" ? <ButtonLink href="/admissions/new" variant="primary" icon="plus">Request admission</ButtonLink> : null}
          {session.role === "admin" ? <ButtonLink href="/admin/wards">Manage wards and beds</ButtonLink> : null}
        </>} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <section aria-label="Beds today" className="mb-section grid gap-gutter md:grid-cols-4">
        {([["Beds in service", census.summary.inService], ["Occupied", census.summary.occupied], ["Available now", census.summary.available], ["Cleaning needed", census.summary.needsCleaning]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-5 shadow-card"><p className="text-sm font-bold text-ink-500">{k}</p><p className="font-mono text-display">{v}</p></div>
        ))}
      </section>
      {waiting.length ? (
        <Card title={`Waiting for a bed (${waiting.length})`} className="mb-section">
          <ul className="divide-y divide-line">
            {waiting.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span><Link href={`/admissions/${a.id}`} className="font-bold">{a.patientName}</Link> · {a.type === "emergency" ? "Emergency" : "Elective"} · {a.reason}</span>
                <span className="text-sm text-ink-500">Requested <DateTimeText at={a.requestedAt} timeZone={tz} /></span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {census.wards.length === 0 ? <EmptyState title="No wards yet">{session.role === "admin" ? <Link href="/admin/wards">Add your first ward and beds.</Link> : "Ask an administrator to set up wards and beds."}</EmptyState> : null}
      <div className="flex flex-col gap-section">
        {census.wards.map((w) => (
          <Card key={w.id} title={`${w.name}${w.active ? "" : " (closed)"}`}>
            {w.beds.length === 0 ? <EmptyState title="No beds in this ward" /> : (
              <ul className="grid gap-gutter sm:grid-cols-2 xl:grid-cols-4">
                {w.beds.map((b) => (
                  <li key={b.id} className="flex flex-col gap-2 rounded border border-line p-4">
                    <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{b.label}</span><Badge visual={BED_VISUAL[b.state]} size="sm" /></div>
                    {b.occupant ? (
                      <p><Link href={`/admissions/${b.occupant.admissionId}`} className="font-bold">{b.occupant.name}</Link><br /><span className="text-sm text-ink-500">{b.occupant.mrn} · since <DateTimeText at={b.occupant.since} timeZone={tz} /></span></p>
                    ) : null}
                    {canClean && (b.state === "needs_cleaning" || b.state === "being_cleaned") ? (
                      <form action={setHousekeeping}>
                        <input type="hidden" name="bed_id" value={b.id} />
                        <input type="hidden" name="state" value={b.state === "needs_cleaning" ? "cleaning" : "clean"} />
                        <SubmitButton size="sm" variant="secondary">{b.state === "needs_cleaning" ? "Start cleaning" : "Mark clean"}</SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
