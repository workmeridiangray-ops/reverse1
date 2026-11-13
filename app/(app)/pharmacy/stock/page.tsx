import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { CheckboxField, SelectField, TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addMedicine, decideReturn, disposeBatch, receiveStock, setBatchStatus } from "../actions";

export const metadata: Metadata = { title: "Stock" };
export const dynamic = "force-dynamic";

export default async function Stock({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("pharmacist", "admin");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [meds, batches, returns, staff] = await Promise.all([
    supabase.from("medicines").select("id, name, strength, form, controlled").order("name"),
    supabase.from("stock_batches").select("*").order("expiry_date"),
    supabase.from("stock_returns").select("id, dispensing_id, qty, reason, claimed_saleable, requested_by, requested_at").eq("status", "pending"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const med = new Map((meds.data ?? []).map((m) => [m.id, m]));
  const sn = new Map((staff.data ?? []).map((s) => [s.id, s.full_name]));
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow="Pharmacy" title="Stock, batches and returns" />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <div className="flex flex-col gap-gutter">
        {(returns.data ?? []).length ? (
          <Card title="Returns awaiting review">
            {(returns.data ?? []).map((r) => (
              <div key={r.id} className="mb-3 border-b border-line pb-3"><p>{r.qty} units · {r.reason} · requested by {sn.get(r.requested_by)} · <DateTimeText at={r.requested_at} timeZone={tz} /> · pharmacist says {r.claimed_saleable ? "sealed and in date" : "not resellable"}</p>
                {r.requested_by === session.userId ? <p className="text-sm text-ink-500">Someone else must review this.</p> : (
                  <form action={decideReturn} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="return_id" value={r.id} /><TextField label="Note (needed to reject)" id={`n-${r.id}`} name="note" optional />
                    <button name="decision" value="accept" className="min-h-touch rounded border border-brand-700 bg-brand-700 px-3 font-bold text-white">Accept</button>
                    <button name="decision" value="reject" className="min-h-touch rounded border border-ink-500 px-3 font-bold">Reject</button></form>)}</div>))}
          </Card>) : null}
        <Card title="Batches">
          {(batches.data ?? []).length === 0 ? <EmptyState title="No stock yet" /> : (
            <Table caption="Stock batches by expiry">
              <thead><tr><Th>Medicine</Th><Th>Batch</Th><Th>Expiry</Th><Th className="text-right">On hand</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>{(batches.data ?? []).map((b) => {
                const m = med.get(b.medicine_id); const expired = b.expiry_date < today;
                const vis = b.status === "disposed" ? { tone: "neutral", icon: "x", label: "Disposed" } : b.status === "recalled" ? { tone: "danger", icon: "alert", label: "Recalled" } : b.status === "quarantined" ? { tone: "warn", icon: "lock", label: "Quarantined" } : expired ? { tone: "danger", icon: "ban", label: "Expired" } : { tone: "ok", icon: "check", label: "Available" };
                return (<tr key={b.id}><Td>{m ? `${m.name} ${m.strength} ${m.form}` : ""}{m?.controlled ? " · controlled" : ""}</Td><Td className="font-mono">{b.batch_no}</Td><Td>{b.expiry_date}</Td><Td className="text-right font-mono">{b.on_hand_qty}</Td>
                  <Td><Badge visual={vis as never} size="sm" />{b.status_reason ? <><br /><span className="text-caption text-ink-500">{b.status_reason}</span></> : null}</Td>
                  <Td>{b.status !== "disposed" ? (
                    <details><summary className="cursor-pointer font-bold text-brand-700">Actions</summary>
                      <div className="mt-2 grid w-64 gap-2">
                        {b.status === "available" || b.status === "quarantined" ? (<form action={setBatchStatus} className="grid gap-2"><input type="hidden" name="batch_id" value={b.id} />
                          {b.status === "quarantined" ? <><input type="hidden" name="status" value="available" /><SubmitButton size="sm" variant="secondary">Release to stock</SubmitButton></> : <><input type="hidden" name="status" value="quarantined" /><TextField label="Reason" id={`q-${b.id}`} name="reason" /><SubmitButton size="sm" variant="secondary">Quarantine</SubmitButton></>}</form>) : null}
                        {b.status !== "recalled" ? (<form action={setBatchStatus} className="grid gap-2"><input type="hidden" name="batch_id" value={b.id} /><input type="hidden" name="status" value="recalled" /><TextField label="Recall reason" id={`rc-${b.id}`} name="reason" /><SubmitButton size="sm" variant="danger">Recall batch</SubmitButton></form>) : null}
                        {(expired || b.status !== "available") ? (<form action={disposeBatch} className="grid gap-2"><input type="hidden" name="batch_id" value={b.id} /><TextField label="Disposal note" id={`ds-${b.id}`} name="reason" /><SubmitButton size="sm" variant="secondary">Dispose of stock</SubmitButton></form>) : null}
                      </div></details>) : null}</Td></tr>);
              })}</tbody>
            </Table>)}
        </Card>
        <div className="grid gap-gutter lg:grid-cols-2">
          <Card title="Receive stock">
            <form action={receiveStock} className="grid gap-4">
              <SelectField label="Medicine" name="medicine_id" id="rs-med"><option value="">Choose…</option>{(meds.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength} {m.form}</option>)}</SelectField>
              <TextField label="Batch number" name="batch_no" id="rs-batch" /><TextField label="Expiry date" name="expiry" id="rs-exp" type="date" />
              <TextField label="Quantity" name="qty" id="rs-qty" inputMode="numeric" /><TextField label="Supplier reference" name="supplier" id="rs-sup" optional />
              <SubmitButton>Receive</SubmitButton></form>
          </Card>
          <Card title="Add a medicine">
            <form action={addMedicine} className="grid gap-4">
              <TextField label="Name" name="name" id="am-name" /><TextField label="Strength" name="strength" id="am-str" hint="e.g. 500 mg" optional /><TextField label="Form" name="form" id="am-form" defaultValue="tablet" />
              <CheckboxField label="Controlled medicine" name="controlled" id="am-ctl" hint="Dispensing needs a second staff member as witness." /><SubmitButton>Add medicine</SubmitButton></form>
          </Card>
        </div>
      </div>
    </>
  );
}
