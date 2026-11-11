import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { rangeText } from "@/components/clinical/LabOrderCard";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { getLabOrder } from "@/lib/data/clinical";
import { isCritical } from "@/lib/rules/lab-flags";
import { ageInYears } from "@/lib/rules/time";
import { LAB_FLAG_VISUAL, LAB_ORDER_VISUAL, RESULT_RELEASE_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { markCollected, saveResults } from "../../actions";

export const metadata: Metadata = { title: "Enter lab results" };
export const dynamic = "force-dynamic";

export default async function LabOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("lab");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const order = await getLabOrder(supabase, id);
  if (!order) notFound();
  await logAccess(supabase, "lab_orders", id);
  const { data: pt } = await supabase.from("patients").select("mrn, date_of_birth, sex_at_birth").eq("id", order.patientId).maybeSingle();
  const tz = session.clinic.timezone;
  const age = pt ? ageInYears(pt.date_of_birth, new Date(), tz) : null;
  const critical = order.results.filter((r) => r.flag && isCritical(r.flag) && !r.acknowledgedAt);
  const closed = order.status === "cancelled";

  return (
    <>
      <PageHeader eyebrow="Lab order" title={order.patientName}
        description={<>{pt ? <><span className="font-mono">{pt.mrn}</span> · {pt.sex_at_birth}{age !== null ? `, ${age} years` : ""} · </> : null}ordered by {order.orderedByName} <DateTimeText at={order.orderedAt} timeZone={tz} /></>}
        actions={<Badge visual={LAB_ORDER_VISUAL[order.status]} />} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="Not saved">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {critical.length > 0 ? (
          <Alert tone="danger" title={`Critical result: phone ${order.orderedByName} now`}>
            <ul className="list-disc pl-5">{critical.map((r) => <li key={r.id}>{r.testName} {r.value} {r.unit} ({LAB_FLAG_VISUAL[r.flag!].label.toLowerCase()})</li>)}</ul>
            <p className="mt-1">This stays here until the doctor acknowledges it. How critical results are communicated is a local policy to be set by the clinic.</p>
          </Alert>
        ) : null}
        {order.clinicalNotes ? <Alert tone="info" title="Note from the doctor">{order.clinicalNotes}</Alert> : null}
        {pt && (pt.sex_at_birth === "unknown" || pt.sex_at_birth === "intersex") ? (
          <Alert tone="warn" title="Sex at birth not recorded as female or male">Sex-specific reference ranges won&apos;t be applied, so some results may show no flag.</Alert>
        ) : null}
      </div>

      {closed ? <Alert tone="warn" title="This order was cancelled">{order.cancelledReason}</Alert> : (
        <Card title="Results">
          {order.status === "ordered" ? (
            <form action={markCollected} className="mb-6">
              <input type="hidden" name="id" value={order.id} />
              <Button type="submit" variant="secondary" icon="check">Mark sample as collected</Button>
            </form>
          ) : null}
          <form action={saveResults} className="flex flex-col gap-5">
            <input type="hidden" name="order_id" value={order.id} />
            <ul className="flex flex-col gap-4">
              {order.results.map((r) => {
                const locked = !!r.releasedAt;
                return (
                  <li key={r.id} className="grid items-start gap-3 rounded border border-line p-4 md:grid-cols-[1fr_12rem_1fr_auto]">
                    <div>
                      <label htmlFor={`value_${r.id}`} className="text-lg font-bold">{r.testName}</label>
                      <p className="text-sm text-ink-500">in {r.unit}</p>
                    </div>
                    <div>
                      <input id={`value_${r.id}`} name={`value_${r.id}`} defaultValue={r.value ?? ""} disabled={locked} inputMode="decimal" autoComplete="off"
                        aria-describedby={`flag_${r.id}`} className="min-h-touch w-full rounded border border-ink-500 bg-surface px-3 font-mono text-lg disabled:bg-sunken" />
                    </div>
                    <div>
                      <label htmlFor={`comment_${r.id}`} className="sr-only">Comment for {r.testName}</label>
                      <input id={`comment_${r.id}`} name={`comment_${r.id}`} defaultValue={r.comment ?? ""} disabled={locked} placeholder="Comment (optional)" maxLength={500}
                        className="min-h-touch w-full rounded border border-ink-500 bg-surface px-3 disabled:bg-sunken" />
                    </div>
                    <div id={`flag_${r.id}`} className="flex flex-col items-start gap-1">
                      {r.flag ? <Badge visual={LAB_FLAG_VISUAL[r.flag]} size="sm" /> : <span className="text-sm text-ink-500">Not entered</span>}
                      {r.value !== null && rangeText(r) ? <span className="text-sm text-ink-700">Reference <span className="font-mono">{rangeText(r)}</span></span> : null}
                      {r.value !== null && r.flag === "unflagged" ? <span className="text-sm text-ink-700">No range for this patient&apos;s sex and age</span> : null}
                      {r.value !== null && r.rangeReviewed === false ? <span className="text-caption text-warn-fg">Placeholder range, not clinician-reviewed</span> : null}
                      {locked ? <Badge visual={RESULT_RELEASE_VISUAL.released} size="sm" /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-ink-500">The flag is worked out for you from the patient&apos;s sex and age. Corrections are allowed until the doctor releases a result, and a corrected critical result needs acknowledging again.</p>
            <div className="flex gap-3">
              <SubmitButton pendingLabel="Saving…">Save results</SubmitButton>
              <Link href="/lab" className="inline-flex min-h-touch items-center px-3 font-bold">Back to the queue</Link>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
