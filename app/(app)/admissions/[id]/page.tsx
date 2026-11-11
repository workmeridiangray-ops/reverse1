import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DateText, DateTimeText } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { getAdmissionDetail } from "@/lib/data/inpatient";
import { requiredClearances, type ClearanceDepartment } from "@/lib/rules/admission";
import { ADMISSION_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import {
  addCareTask, addObservation, allocateBed, authoriseDischarge, cancelAdmission, finaliseDischarge, recordClearance,
  recordTask, releaseReservation, reserveBed, transferBed, updateExpectedDischarge, withdrawAuthorisation,
} from "../actions";

export const metadata: Metadata = { title: "Admission" };
export const dynamic = "force-dynamic";

const DEPT_LABEL: Record<ClearanceDepartment, string> = { finance: "Finance", pharmacy: "Pharmacy", nursing: "Nursing" };
const DEPT_ROLES: Record<ClearanceDepartment, string[]> = { finance: ["admin", "receptionist"], pharmacy: ["admin", "pharmacist"], nursing: ["admin", "nurse"] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin", "receptionist", "doctor", "nurse", "pharmacist");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: clinic } = await supabase.from("clinics").select("emergency_requires_finance_clearance").eq("id", session.clinic.id).single();
  const d = await getAdmissionDetail(supabase, id, { emergencyNeedsFinance: clinic?.emergency_requires_finance_clearance ?? false });
  if (!d || !d.patient) notFound();
  await logAccess(supabase, "admissions", id);

  const { admission: a, patient: p } = d;
  const role = session.role;
  const tz = session.clinic.timezone;
  const status = a.status as "requested" | "admitted" | "discharged" | "cancelled";
  const needed = requiredClearances(a.admission_type as "elective" | "emergency", clinic?.emergency_requires_finance_clearance ?? false);
  const cleared = new Map(d.clearances.map((c) => [c.department as ClearanceDepartment, c]));
  const isClinical = role === "doctor" || role === "nurse";
  const nowLocal = new Date().toISOString().slice(0, 16);

  return (
    <>
      <PageHeader
        eyebrow={`Admission · ${p.mrn}`}
        title={`${p.given_name} ${p.family_name}`}
        description={<span className="flex flex-wrap items-center gap-3"><Badge visual={ADMISSION_VISUAL[status]} /><span>{a.admission_type === "emergency" ? "Emergency" : "Elective"} · attending {d.attending}</span><Link href={`/patients/${p.id}`}>Patient record</Link></span>}
      />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>

      <div className="grid gap-gutter xl:grid-cols-[1fr_26rem]">
        <div className="flex flex-col gap-gutter">
          <Card title="Admission">
            <DefinitionList items={[
              ["Reason", a.reason],
              ["Deposit reference", a.deposit_reference ?? (a.admission_type === "emergency" ? "Not required (emergency)" : "—")],
              ["Requested", <><DateTimeText at={a.requested_at} timeZone={tz} />{d.names.requestedBy ? ` by ${d.names.requestedBy}` : ""}</>],
              ["Admitted", a.admitted_at ? <DateTimeText at={a.admitted_at} timeZone={tz} /> : "Not yet"],
              ["Expected discharge", a.expected_discharge_on ? <DateText at={`${a.expected_discharge_on}T12:00:00Z`} timeZone="UTC" /> : "Not set"],
              ["Billed bed-days", d.billedBedDays === null ? "—" : `${d.billedBedDays} (midnight census; separate from physical occupancy)`],
              ...(a.cancelled_reason ? [["Cancelled because", a.cancelled_reason] as [string, string]] : []),
              ...(a.discharged_at ? [["Discharged", <><DateTimeText at={a.discharged_at} timeZone={tz} />{d.names.dischargedBy ? ` by ${d.names.dischargedBy}` : ""}</>] as [string, React.ReactNode]] : []),
            ]} />
            {["admin", "receptionist", "doctor"].includes(role) && (status === "requested" || status === "admitted") ? (
              <form action={updateExpectedDischarge} className="mt-5 flex flex-wrap items-end gap-3">
                <input type="hidden" name="admission_id" value={a.id} />
                <input type="hidden" name="row_version" value={a.row_version} />
                <TextField label="Expected discharge date" name="expected_discharge_on" type="date" defaultValue={a.expected_discharge_on ?? ""} optional />
                <SubmitButton size="sm" variant="secondary">Save date</SubmitButton>
              </form>
            ) : null}
          </Card>

          <Card title="Bed history">
            {d.stays.length === 0 ? <EmptyState title="No bed yet" /> : (
              <Table caption="Bed stays">
                <thead><tr><Th>Bed</Th><Th>From</Th><Th>To</Th><Th>Reason</Th></tr></thead>
                <tbody>{d.stays.map((s) => (
                  <tr key={s.id}><Td className="font-mono">{s.bed}</Td><Td><DateTimeText at={s.starts_at} timeZone={tz} /></Td>
                    <Td>{s.ends_at ? <DateTimeText at={s.ends_at} timeZone={tz} /> : "Current"}</Td><Td>{s.reason === "transfer" ? `Transfer${s.note ? ` · ${s.note}` : ""}` : "Admission"}</Td></tr>
                ))}</tbody>
              </Table>
            )}
          </Card>

          {isClinical && status === "admitted" ? (
            <>
              <Card title="Observations">
                <form action={addObservation} className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3">
                  <input type="hidden" name="admission_id" value={a.id} /><input type="hidden" name="patient_id" value={p.id} />
                  <TextField label="Systolic (mmHg)" name="systolic" inputMode="numeric" optional />
                  <TextField label="Diastolic (mmHg)" name="diastolic" inputMode="numeric" optional />
                  <TextField label="Pulse (/min)" name="pulse" inputMode="numeric" optional />
                  <TextField label="Resp. rate (/min)" name="resp_rate" inputMode="numeric" optional />
                  <TextField label="Temp (°C)" name="temp_c" inputMode="decimal" optional />
                  <TextField label="SpO₂ (%)" name="spo2" inputMode="numeric" optional />
                  <div className="col-span-2 md:col-span-3"><TextField label="Note" name="note" optional /></div>
                  <div className="col-span-2 md:col-span-3"><SubmitButton pendingLabel="Recording…">Record observations</SubmitButton></div>
                </form>
                <ObservationTable rows={d.observations} tz={tz} canCorrect={isClinical} admissionId={a.id} patientId={p.id} />
              </Card>
              <Card title="Care tasks">
                <ul className="mb-5 divide-y divide-line">
                  {d.tasks.length === 0 ? <li><EmptyState title="No tasks" /></li> : null}
                  {d.tasks.map((t) => (
                    <li key={t.id} className="flex flex-col gap-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold">{t.title}</span>
                        <span className="text-sm text-ink-500">Due <DateTimeText at={t.due_at} timeZone={tz} /> · {t.status === "pending" ? "Pending" : t.status === "done" ? `Done by ${t.by ?? "—"}` : `Not done (${t.not_done_reason}) · ${t.by ?? "—"}`}</span>
                      </div>
                      {t.status === "pending" && role === "nurse" ? (
                        <div className="flex flex-wrap gap-3">
                          <form action={recordTask}><input type="hidden" name="admission_id" value={a.id} /><input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="outcome" value="done" /><SubmitButton size="sm" variant="secondary">Mark done</SubmitButton></form>
                          <form action={recordTask} className="flex flex-wrap items-end gap-2"><input type="hidden" name="admission_id" value={a.id} /><input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="outcome" value="not_done" />
                            <TextField label="Reason if not done" id={`reason-${t.id}`} name="reason" /><SubmitButton size="sm" variant="secondary">Not done</SubmitButton></form>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <form action={addCareTask} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="admission_id" value={a.id} /><input type="hidden" name="patient_id" value={p.id} />
                  <TextField label="New task" name="title" /><TextField label="Due" name="due_at" type="datetime-local" defaultValue={nowLocal} />
                  <SubmitButton size="sm" variant="secondary">Add task</SubmitButton>
                </form>
              </Card>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-gutter">
          {status === "requested" ? (
            <>
              <Card title="Give a bed">
                {role === "doctor" ? <p className="text-ink-700">A nurse or the front desk allocates the bed.</p> : d.allocatable.length === 0 ? <Alert tone="warn" title="No bed is available right now">Beds that are occupied, dirty, closed or out of service are not listed. Reserve one below or mark a bed clean on the ward census.</Alert> : (
                  <form action={allocateBed} className="flex flex-col gap-4"><input type="hidden" name="admission_id" value={a.id} />
                    <BedSelect beds={d.allocatable} idKey="allocate" /><SubmitButton pendingLabel="Allocating…">Allocate and admit</SubmitButton></form>
                )}
              </Card>
              {role !== "doctor" ? (
                <Card title="Planned reservation">
                  <ul className="mb-4">{d.reservations.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1"><span>{r.bed} · <DateTimeText at={r.reserved_from} timeZone={tz} /> to <DateTimeText at={r.reserved_until} timeZone={tz} /></span>
                      <form action={releaseReservation}><input type="hidden" name="admission_id" value={a.id} /><input type="hidden" name="reservation_id" value={r.id} /><SubmitButton size="sm" variant="ghost">Release</SubmitButton></form></li>
                  ))}</ul>
                  <form action={reserveBed} className="flex flex-col gap-4"><input type="hidden" name="admission_id" value={a.id} />
                    <BedSelect beds={d.allocatable} idKey="reserve" /><TextField label="From" name="from" type="datetime-local" defaultValue={nowLocal} /><TextField label="Until" name="until" type="datetime-local" />
                    <SubmitButton variant="secondary">Reserve bed</SubmitButton></form>
                </Card>
              ) : null}
              <Card title="Cancel request">
                <form action={cancelAdmission} className="flex flex-col gap-4"><input type="hidden" name="admission_id" value={a.id} />
                  <TextAreaField label="Reason" name="reason" hint="Required. At least 5 characters." /><SubmitButton variant="danger">Cancel admission request</SubmitButton></form>
              </Card>
            </>
          ) : null}

          {status === "admitted" ? (
            <>
              {role === "admin" || role === "nurse" ? (
                <Card title="Transfer to another bed">
                  {d.allocatable.length === 0 ? <p className="text-ink-700">No bed is available to move to.</p> : (
                    <form action={transferBed} className="flex flex-col gap-4"><input type="hidden" name="admission_id" value={a.id} />
                      <BedSelect beds={d.allocatable} idKey="transfer" /><TextField label="Effective time" name="effective_at" type="datetime-local" optional hint="Leave empty for now. Cannot be in the future." />
                      <TextField label="Note" name="note" optional /><SubmitButton variant="secondary">Record transfer</SubmitButton></form>
                  )}
                </Card>
              ) : null}
              <Card title="Discharge">
                {d.blockers.length ? (
                  <Alert tone="warn" title="Still outstanding"><ul className="list-disc pl-5">{d.blockers.map((b) => <li key={b}>{b}</li>)}</ul></Alert>
                ) : <Alert tone="ok" title="Ready for final discharge" />}
                <h3 className="mb-2 mt-5 font-bold">Clinical authorisation</h3>
                {a.discharge_authorised_at ? <p className="mb-3">Authorised by {d.names.authorisedBy ?? "a doctor"} on <DateTimeText at={a.discharge_authorised_at} timeZone={tz} />.</p> : <p className="mb-3 text-ink-700">Not yet authorised.</p>}
                {role === "doctor" ? (
                  <>
                    <form action={authoriseDischarge} className="flex flex-col gap-3"><input type="hidden" name="admission_id" value={a.id} />
                      <TextAreaField label="Discharge summary" name="summary" defaultValue={d.summary?.summary ?? ""} hint="Signing this authorises discharge. You can withdraw it with a reason." />
                      <SubmitButton pendingLabel="Authorising…">{a.discharge_authorised_at ? "Update summary" : "Authorise discharge"}</SubmitButton></form>
                    {a.discharge_authorised_at ? (
                      <form action={withdrawAuthorisation} className="mt-4 flex flex-col gap-3"><input type="hidden" name="admission_id" value={a.id} />
                        <TextField label="Reason for withdrawing" name="reason" /><SubmitButton variant="secondary">Withdraw authorisation</SubmitButton></form>
                    ) : null}
                  </>
                ) : d.summary && d.summaryReadable ? <p className="whitespace-pre-wrap rounded bg-canvas p-3">{d.summary.summary}</p> : null}
                <h3 className="mb-2 mt-5 font-bold">Department clearances</h3>
                <ul className="flex flex-col gap-3">
                  {needed.map((dept) => {
                    const c = cleared.get(dept);
                    const mine = DEPT_ROLES[dept].includes(role);
                    return (
                      <li key={dept} className="rounded border border-line p-3">
                        <div className="flex items-center justify-between"><span className="font-bold">{DEPT_LABEL[dept]}</span>
                          {c ? <Badge visual={{ tone: c.status === "exception" ? "warn" : "ok", icon: c.status === "exception" ? "alert" : "check", label: c.status === "exception" ? "Cleared by exception" : "Cleared" }} size="sm" /> : <Badge visual={{ tone: "neutral", icon: "hourglass", label: "Outstanding" }} size="sm" />}</div>
                        {c ? <p className="text-sm text-ink-500">{c.by} · <DateTimeText at={c.cleared_at} timeZone={tz} />{c.note ? ` · ${c.note}` : ""}</p> : null}
                        {!c && mine ? (
                          <form action={recordClearance} className="mt-2 flex flex-col gap-2"><input type="hidden" name="admission_id" value={a.id} /><input type="hidden" name="department" value={dept} />
                            <input type="hidden" name="status" value="cleared" /><SubmitButton size="sm" variant="secondary">Mark {DEPT_LABEL[dept].toLowerCase()} cleared</SubmitButton></form>
                        ) : null}
                        {!c && role === "admin" ? (
                          <form action={recordClearance} className="mt-3 flex flex-col gap-2"><input type="hidden" name="admission_id" value={a.id} /><input type="hidden" name="department" value={dept} /><input type="hidden" name="status" value="exception" />
                            <TextField label={`Exception reason for ${DEPT_LABEL[dept].toLowerCase()}`} id={`exc-${dept}`} name="note" hint="Clearing despite an outstanding item. At least 10 characters. Audited." />
                            <SubmitButton size="sm" variant="ghost">Clear by exception</SubmitButton></form>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {["admin", "receptionist", "nurse"].includes(role) ? (
                  <form action={finaliseDischarge} className="mt-5"><input type="hidden" name="admission_id" value={a.id} />
                    <Button type="submit" disabled={d.blockers.length > 0} aria-disabled={d.blockers.length > 0}>Final discharge</Button>
                    {d.blockers.length ? <p className="mt-2 text-sm text-ink-500">Available once everything above is complete.</p> : null}</form>
                ) : null}
              </Card>
            </>
          ) : null}
          {status === "discharged" && d.summary ? <Card title="Discharge summary"><p className="whitespace-pre-wrap">{d.summary.summary}</p></Card> : null}
        </div>
      </div>
    </>
  );
}

function BedSelect({ beds, idKey }: { beds: Array<{ id: string; label: string }>; idKey: string }) {
  return (
    <SelectField label="Bed" name="bed_id" id={`bed-${idKey}`}>
      <option value="">Choose a bed…</option>
      {beds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
    </SelectField>
  );
}

function ObservationTable({ rows, tz, canCorrect, admissionId, patientId }: {
  rows: Array<{ id: string; recorded_at: string; by: string; systolic: number | null; diastolic: number | null; pulse: number | null; resp_rate: number | null; temp_c: number | null; spo2: number | null; note: string | null; corrects_id: string | null; correction_reason: string | null }>;
  tz: string; canCorrect: boolean; admissionId: string; patientId: string;
}) {
  if (rows.length === 0) return <EmptyState title="No observations yet" />;
  const corrected = new Set(rows.map((r) => r.corrects_id).filter(Boolean));
  return (
    <Table caption="Observations, newest first">
      <thead><tr><Th>Time</Th><Th>BP</Th><Th>Pulse</Th><Th>RR</Th><Th>Temp</Th><Th>SpO₂</Th><Th>By</Th><Th><span className="sr-only">Correct</span></Th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} className={corrected.has(r.id) ? "text-ink-500 line-through decoration-1" : ""}>
          <Td><DateTimeText at={r.recorded_at} timeZone={tz} />{r.corrects_id ? <><br /><span className="text-caption no-underline">Correction: {r.correction_reason}</span></> : null}{corrected.has(r.id) ? <><br /><span className="text-caption">Superseded</span></> : null}</Td>
          <Td className="font-mono">{r.systolic ?? "–"}/{r.diastolic ?? "–"}</Td><Td className="font-mono">{r.pulse ?? "–"}</Td><Td className="font-mono">{r.resp_rate ?? "–"}</Td>
          <Td className="font-mono">{r.temp_c ?? "–"}</Td><Td className="font-mono">{r.spo2 ?? "–"}</Td><Td>{r.by}</Td>
          <Td>{canCorrect && !corrected.has(r.id) && !r.corrects_id ? (
            <details><summary className="cursor-pointer font-bold text-brand-700">Correct</summary>
              <form action={addObservation} className="mt-2 grid w-64 gap-2">
                <input type="hidden" name="admission_id" value={admissionId} /><input type="hidden" name="patient_id" value={patientId} /><input type="hidden" name="corrects_id" value={r.id} />
                <TextField label="Systolic" id={`s-${r.id}`} name="systolic" optional defaultValue={r.systolic ?? ""} /><TextField label="Diastolic" id={`d-${r.id}`} name="diastolic" optional defaultValue={r.diastolic ?? ""} />
                <TextField label="Pulse" id={`p-${r.id}`} name="pulse" optional defaultValue={r.pulse ?? ""} /><TextField label="Why?" id={`w-${r.id}`} name="correction_reason" />
                <SubmitButton size="sm" variant="secondary">Record correction</SubmitButton></form></details>
          ) : null}</Td>
        </tr>
      ))}</tbody>
    </Table>
  );
}
