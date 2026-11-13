import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckboxField, SelectField, TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { decideSubstitution, dispense, requestReturn, requestSubstitution } from "../../actions";

export const metadata: Metadata = { title: "Prescription" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("pharmacist", "doctor");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: rx } = await supabase.from("prescriptions").select("*").eq("id", id).maybeSingle();
  if (!rx) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const [pt, disp, subs, meds, batches, staff] = await Promise.all([
    supabase.from("patients").select("given_name, family_name, mrn").eq("id", rx.patient_id).single(),
    supabase.from("dispensings").select("id, qty, returned_qty, batch_id, dispensed_at, dispensed_by").eq("prescription_id", id).order("dispensed_at"),
    supabase.from("substitutions").select("id, medicine_id, reason, status").eq("prescription_id", id),
    supabase.from("medicines").select("id, name, strength, form, controlled").eq("active", true).order("name"),
    session.role === "pharmacist" ? supabase.from("stock_batches").select("id, medicine_id, batch_no, expiry_date, on_hand_qty, status").eq("status", "available").gt("on_hand_qty", 0).gte("expiry_date", today).order("expiry_date") : Promise.resolve({ data: [] as never[] }),
    session.role === "pharmacist" ? supabase.from("profiles").select("id, full_name, role").in("role", ["pharmacist", "doctor", "nurse"]).eq("active", true) : Promise.resolve({ data: [] as never[] }),
  ]);
  const med = new Map((meds.data ?? []).map((m) => [m.id, m]));
  const label = (mid: string) => { const m = med.get(mid); return m ? `${m.name} ${m.strength} ${m.form}` : "Medicine"; };
  const approved = new Set((subs.data ?? []).filter((s) => s.status === "approved").map((s) => s.medicine_id));
  const allowed = new Set([rx.medicine_id, ...approved].filter(Boolean) as string[]);
  const dispensed = (disp.data ?? []).reduce((t, d) => t + d.qty - d.returned_qty, 0);
  const left = (rx.quantity ?? 0) - dispensed;
  const usable = ((batches.data ?? []) as Array<{ id: string; medicine_id: string; batch_no: string; expiry_date: string; on_hand_qty: number }>).filter((b) => allowed.has(b.medicine_id));
  const bn = new Map(((batches.data ?? []) as Array<{ id: string; batch_no: string }>).map((b) => [b.id, b.batch_no]));
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow="Prescription" title={rx.drug_name} description={<>{pt.data?.given_name} {pt.data?.family_name} · {pt.data?.mrn}</>} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {rx.status === "active" && (!rx.quantity || !rx.medicine_id) ? <Alert tone="warn" title="This prescription can't be dispensed">It has no catalogue medicine or quantity. Ask the prescriber to write it again.</Alert> : null}
      </div>
      <div className="grid gap-gutter lg:grid-cols-2">
        <Card title="Prescription">
          <DefinitionList items={[["Directions", `${rx.dose}, ${rx.route}, ${rx.frequency}${rx.duration_days ? `, ${rx.duration_days} days` : ""}`], ["Prescribed", String(rx.quantity ?? "—")], ["Dispensed (net of returns)", String(dispensed)], ["Still to dispense", String(Math.max(left, 0))], ["Status", rx.status]]} />
        </Card>
        {session.role === "pharmacist" && rx.status === "active" && left > 0 ? (
          <Card title="Dispense">
            {usable.length === 0 ? <Alert tone="warn" title="No usable stock">Nothing in date and available for this medicine. Request a substitution or receive stock.</Alert> : (
              <form action={dispense} className="flex flex-col gap-4"><input type="hidden" name="prescription_id" value={id} />
                <SelectField label="Batch (earliest expiry first)" name="batch_id" id="d-batch">{usable.map((b) => <option key={b.id} value={b.id}>{b.batch_no} · {label(b.medicine_id)} · expires {b.expiry_date} · {b.on_hand_qty} in stock</option>)}</SelectField>
                <TextField label="Quantity" name="qty" id="d-qty" defaultValue={String(Math.min(left, usable[0]?.on_hand_qty ?? left))} inputMode="numeric" hint="A partial supply is fine; the prescription stays open." />
                {allowed.size && [...allowed].some((m) => med.get(m)?.controlled) ? (
                  <SelectField label="Witness (controlled medicine)" name="witness_id" id="d-witness" optional hint="A different staff member who checked the supply."><option value="">None</option>
                    {((staff.data ?? []) as Array<{ id: string; full_name: string; role: string }>).filter((s) => s.id !== session.userId).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}</SelectField>) : null}
                <SubmitButton pendingLabel="Dispensing…">Dispense</SubmitButton></form>)}
          </Card>) : null}
        <Card title="Dispensing history" className="lg:col-span-2">
          {(disp.data ?? []).length === 0 ? <p className="text-ink-700">Nothing dispensed yet.</p> : (
            <ul className="divide-y divide-line">{(disp.data ?? []).map((d) => (
              <li key={d.id} className="py-3">{d.qty} supplied from batch {bn.get(d.batch_id) ?? d.batch_id.slice(0, 8)} · <DateTimeText at={d.dispensed_at} timeZone={tz} />{d.returned_qty ? ` · ${d.returned_qty} returned` : ""}
                {session.role === "pharmacist" && d.qty - d.returned_qty > 0 ? (
                  <details className="mt-1"><summary className="cursor-pointer font-bold text-brand-700">Return some</summary>
                    <form action={requestReturn} className="mt-2 grid max-w-md gap-3"><input type="hidden" name="prescription_id" value={id} /><input type="hidden" name="dispensing_id" value={d.id} />
                      <TextField label="Quantity" id={`rq-${d.id}`} name="qty" inputMode="numeric" /><TextField label="Reason" id={`rr-${d.id}`} name="reason" />
                      <CheckboxField label="Sealed and in date: can go back on the shelf" name="saleable" id={`rs-${d.id}`} />
                      <SubmitButton size="sm" variant="secondary">Record return for review</SubmitButton></form></details>) : null}</li>))}</ul>)}
        </Card>
        <Card title="Substitutions" className="lg:col-span-2">
          {(subs.data ?? []).map((s) => (
            <div key={s.id} className="mb-3 flex flex-wrap items-center justify-between gap-3"><span>{label(s.medicine_id)} · {s.status} · {s.reason}</span>
              {s.status === "requested" && session.role === "doctor" && rx.prescriber_id === session.userId ? (
                <form action={decideSubstitution} className="flex gap-2"><input type="hidden" name="prescription_id" value={id} /><input type="hidden" name="substitution_id" value={s.id} />
                  <button name="decision" value="approve" className="min-h-touch rounded border border-brand-700 bg-brand-700 px-3 font-bold text-white">Approve</button>
                  <button name="decision" value="reject" className="min-h-touch rounded border border-ink-500 px-3 font-bold">Reject</button></form>) : null}</div>))}
          {session.role === "pharmacist" && rx.status === "active" ? (
            <form action={requestSubstitution} className="grid max-w-xl gap-3 border-t border-line pt-4"><input type="hidden" name="prescription_id" value={id} />
              <SelectField label="Request a substitute" name="medicine_id" id="s-med"><option value="">Choose…</option>{(meds.data ?? []).filter((m) => m.id !== rx.medicine_id).map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength} {m.form}</option>)}</SelectField>
              <TextField label="Reason" name="reason" id="s-reason" /><SubmitButton variant="secondary">Ask the prescriber to approve</SubmitButton></form>) : null}
        </Card>
      </div>
    </>
  );
}
