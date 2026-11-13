import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { PROCEDURE_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { cancelProcedure, completeRecovery, moveToRecovery, recordConsent, scheduleProcedure, startProcedure, tickChecklist, withdrawConsent, writeNote } from "../actions";

export const metadata: Metadata = { title: "Procedure" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProcedurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin", "doctor", "nurse");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: p } = await supabase.from("procedures").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [pt, rooms, staff, team, checklist, consent, notes, changes] = await Promise.all([
    supabase.from("patients").select("given_name, family_name, mrn, date_of_birth").eq("id", p.patient_id).single(),
    supabase.from("rooms").select("id, name, out_of_service").eq("kind", "procedure").order("name"),
    supabase.from("profiles").select("id, full_name, role").eq("active", true).in("role", ["doctor", "nurse"]).order("full_name"),
    supabase.from("procedure_team").select("user_id, team_role").eq("procedure_id", id).eq("active", true),
    supabase.from("procedure_checklist").select("id, item, done_by, done_at").eq("procedure_id", id).order("item"),
    session.role === "admin" ? Promise.resolve({ data: [] as never[] }) : supabase.from("procedure_consents").select("*").eq("procedure_id", id).order("obtained_at", { ascending: false }),
    session.role === "admin" ? Promise.resolve({ data: [] as never[] }) : supabase.from("procedure_notes").select("*").eq("procedure_id", id).order("version", { ascending: false }),
    supabase.from("procedure_changes").select("change, reason, at, by_user").eq("procedure_id", id).order("id", { ascending: false }),
  ]);
  const sn = new Map((staff.data ?? []).map((s) => [s.id, s.full_name]));
  const tz = session.clinic.timezone;
  const role = session.role;
  const activeConsent = ((consent.data ?? []) as Array<{ id: string; withdrawn_at: string | null; consenter_name: string; relationship: string; method: string; evidence_ref: string; obtained_at: string }>).find((c) => !c.withdrawn_at);
  const open = (checklist.data ?? []).filter((c) => !c.done_at).length;
  const pre = p.status === "requested" || p.status === "scheduled";
  const names = (r: string) => (staff.data ?? []).filter((s) => r === "nurse" ? s.role === "nurse" : s.role === "doctor");
  return (
    <>
      <PageHeader eyebrow="Procedure" title={p.name} description={<span className="flex flex-wrap items-center gap-3"><Badge visual={PROCEDURE_VISUAL[p.status as keyof typeof PROCEDURE_VISUAL]} />{pt.data?.given_name} {pt.data?.family_name} · {pt.data?.mrn} · surgeon {sn.get(p.surgeon_id)} · {p.urgency}</span>} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {p.version > 2 ? <Alert tone="warn" title="This procedure has been rescheduled">See the change log below for when and why.</Alert> : null}
      </div>
      <div className="grid gap-gutter xl:grid-cols-2">
        <Card title="Schedule">
          <DefinitionList items={[["Theatre", (rooms.data ?? []).find((r) => r.id === p.room_id)?.name ?? "Not scheduled"], ["Starts", p.starts_at ? <DateTimeText key="s" at={p.starts_at} timeZone={tz} /> : "—"], ["Ends", p.ends_at ? <DateTimeText key="e" at={p.ends_at} timeZone={tz} /> : "—"],
            ["Team", (team.data ?? []).length ? (team.data ?? []).map((t) => `${sn.get(t.user_id) ?? "—"} (${t.team_role.replace("_", " ")})`).join(", ") : "—"]]} />
          {(role === "admin" || role === "nurse") && pre ? (
            <form action={scheduleProcedure} className="mt-5 grid gap-4"><input type="hidden" name="procedure_id" value={id} />
              <SelectField label="Theatre" name="room_id" id="sc-room" defaultValue={p.room_id ?? ""}><option value="">Choose…</option>{(rooms.data ?? []).filter((r) => !r.out_of_service).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectField>
              <div className="grid grid-cols-2 gap-4"><TextField label="Starts" name="starts" id="sc-start" type="datetime-local" /><TextField label="Ends" name="ends" id="sc-end" type="datetime-local" /></div>
              <SelectField label="Anaesthetist" name="anaesthetist" id="sc-an" optional><option value="">None</option>{names("doctor").map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</SelectField>
              <SelectField label="Scrub nurse" name="scrub_nurse" id="sc-sn" optional><option value="">None</option>{names("nurse").map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</SelectField>
              <SelectField label="Circulating nurse" name="circulating_nurse" id="sc-cn" optional><option value="">None</option>{names("nurse").map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</SelectField>
              {p.status === "scheduled" ? <TextField label="Reason for the change" name="reason" id="sc-reason" /> : null}
              <SubmitButton>{p.status === "scheduled" ? "Reschedule" : "Schedule"}</SubmitButton></form>) : null}
        </Card>
        {p.status !== "requested" && p.status !== "cancelled" ? (
          <Card title="Pre-procedure checklist">
            <p className="mb-3 text-sm text-ink-500">Each tick records who confirmed the check. It does not replace the check itself.</p>
            <ul className="divide-y divide-line">{(checklist.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2"><span>{c.item}{c.done_at ? <span className="block text-caption text-ink-500">{sn.get(c.done_by!) ?? "—"} · <DateTimeText at={c.done_at} timeZone={tz} /></span> : null}</span>
                {!c.done_at && p.status === "scheduled" && (role === "nurse" || role === "doctor") ? <form action={tickChecklist}><input type="hidden" name="procedure_id" value={id} /><input type="hidden" name="item_id" value={c.id} /><SubmitButton size="sm" variant="secondary">Confirm</SubmitButton></form> : c.done_at ? <Badge visual={{ tone: "ok", icon: "check", label: "Done" }} size="sm" /> : null}</li>))}</ul>
          </Card>) : null}
        {role !== "admin" ? (
          <Card title="Consent">
            {activeConsent ? (<>
              <DefinitionList items={[["Given by", `${activeConsent.consenter_name} (${activeConsent.relationship.replace("_", " ")})`], ["Method", activeConsent.method.replace("_", " ")], ["Evidence", activeConsent.evidence_ref], ["Recorded", <DateTimeText key="c" at={activeConsent.obtained_at} timeZone={tz} />]]} />
              {role === "doctor" && pre ? <form action={withdrawConsent} className="mt-4 grid gap-3"><input type="hidden" name="procedure_id" value={id} /><TextField label="Reason for withdrawing" name="reason" id="wc-reason" /><SubmitButton variant="secondary">Withdraw consent</SubmitButton></form> : null}
            </>) : <p className="text-ink-700">No active consent recorded.</p>}
            {role === "doctor" && pre && !activeConsent ? (
              <form action={recordConsent} className="mt-4 grid gap-4"><input type="hidden" name="procedure_id" value={id} />
                <TextField label="Consent given by" name="consenter" id="cs-name" />
                <SelectField label="Relationship" name="relationship" id="cs-rel"><option value="self">The patient</option><option value="guardian">Guardian</option><option value="legal_proxy">Legal proxy</option></SelectField>
                <SelectField label="Method" name="method" id="cs-method"><option value="written">Written form</option><option value="verbal_witnessed">Verbal, witnessed</option></SelectField>
                <TextField label="Witness (needed for verbal)" name="witness" id="cs-wit" optional />
                <TextField label="Evidence reference" name="evidence" id="cs-ev" hint="e.g. Form F-22 scanned, record 4471" />
                <SubmitButton>Record consent evidence</SubmitButton></form>) : null}
          </Card>) : null}
        <Card title="Run the procedure">
          {p.status === "scheduled" && (role === "doctor" || role === "nurse") ? (
            <form action={startProcedure} className="grid gap-3"><input type="hidden" name="procedure_id" value={id} />
              {open > 0 || !activeConsent ? <Alert tone="warn" title="Not ready">{open > 0 ? `${open} checklist item(s) open. ` : ""}{!activeConsent ? "No consent recorded." : ""}</Alert> : null}
              {p.urgency === "emergency" ? <TextField label="Emergency override reason (only if items are open)" name="override" id="st-ov" optional hint="At least 10 characters. Logged." /> : null}
              <SubmitButton>Start procedure</SubmitButton></form>) : null}
          {p.status === "in_progress" && role === "doctor" ? (
            <form action={writeNote} className="grid gap-3"><input type="hidden" name="procedure_id" value={id} /><TextAreaField label="Procedure note" name="body" id="pn-body" /><SubmitButton variant="secondary">Save note</SubmitButton></form>) : null}
          {p.status === "in_progress" && (role === "doctor" || role === "nurse") ? <form action={moveToRecovery} className="mt-4"><input type="hidden" name="procedure_id" value={id} /><SubmitButton>Move to recovery</SubmitButton><p className="mt-1 text-sm text-ink-500">Needs the surgeon's procedure note first.</p></form> : null}
          {p.status === "recovery" && (role === "nurse" || role === "doctor") ? <form action={completeRecovery}><input type="hidden" name="procedure_id" value={id} /><SubmitButton>Recovery complete</SubmitButton></form> : null}
          {p.status === "completed" && role === "doctor" ? (
            <form action={writeNote} className="grid gap-3"><input type="hidden" name="procedure_id" value={id} /><TextAreaField label="Amend the procedure note (new version)" name="body" id="pn-amend" /><TextField label="Reason for amendment" name="reason" id="pn-reason" /><SubmitButton variant="secondary">Save amendment</SubmitButton></form>) : null}
          {pre ? (
            <form action={cancelProcedure} className="mt-5 grid gap-3 border-t border-line pt-4"><input type="hidden" name="procedure_id" value={id} /><TextField label="Reason for cancelling" name="reason" id="cp-reason" /><SubmitButton variant="danger" size="sm">Cancel procedure</SubmitButton></form>) : null}
        </Card>
        {((notes.data ?? []) as Array<{ id: string; version: number; body: string; written_at: string; amendment_reason: string | null; written_by: string }>).length ? (
          <Card title="Procedure notes" className="xl:col-span-2">
            <ul className="divide-y divide-line">{((notes.data ?? []) as Array<{ id: string; version: number; body: string; written_at: string; amendment_reason: string | null; written_by: string }>).map((n) => (
              <li key={n.id} className="py-3"><p className="whitespace-pre-wrap">{n.body}</p><p className="text-sm text-ink-500">Version {n.version} · {sn.get(n.written_by)} · <DateTimeText at={n.written_at} timeZone={tz} />{n.amendment_reason ? ` · amended: ${n.amendment_reason}` : ""}</p></li>))}</ul>
          </Card>) : null}
        <Card title="Change log" className="xl:col-span-2">
          <ul className="divide-y divide-line">{(changes.data ?? []).map((c, i) => (<li key={i} className="py-2">{c.change}{c.reason ? ` — ${c.reason}` : ""}<span className="block text-sm text-ink-500">{c.by_user ? sn.get(c.by_user) : ""} <DateTimeText at={c.at} timeZone={tz} /></span></li>))}</ul>
        </Card>
      </div>
    </>
  );
}
