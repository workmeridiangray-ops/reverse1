import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { collectSpecimen, enterResult, publishResult } from "../../actions";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAG = { normal: { tone: "ok", icon: "check", label: "Normal" }, abnormal: { tone: "warn", icon: "alert", label: "Abnormal" }, critical: { tone: "critical", icon: "flag", label: "Critical" } } as const;

export default async function LabOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("lab", "admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: o } = await supabase.from("lab_orders").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [pt, doc, results] = await Promise.all([
    supabase.from("patients").select("given_name, family_name, mrn, date_of_birth").eq("id", o.patient_id).single(),
    supabase.from("profiles").select("full_name").eq("id", o.ordered_by).single(),
    supabase.from("lab_results").select("*").eq("order_id", id).order("version", { ascending: false }),
  ]);
  const rs = results.data ?? [];
  const draft = rs.find((r) => r.state === "draft");
  const tz = session.clinic.timezone;
  const canEnter = (o.status === "collected" || o.status === "published" || (o.status === "resulted" && !draft)) && !draft;
  const amending = o.status === "published";
  return (
    <>
      <PageHeader eyebrow={`${o.kind === "imaging" ? "Imaging" : "Laboratory"} order${o.accession ? ` · ${o.accession}` : ""}`} title={o.test_name}
        description={<>{pt.data?.given_name} {pt.data?.family_name} · {pt.data?.mrn} · DOB {pt.data?.date_of_birth} · ordered by {doc.data?.full_name}</>} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {o.status === "cancelled" ? <Alert tone="warn" title="Cancelled">{o.cancel_reason}</Alert> : null}
      </div>
      <div className="grid gap-gutter lg:grid-cols-2">
        <Card title="Order">
          <DefinitionList items={[["Status", o.status], ["Priority", o.priority], ["Clinical note", o.clinical_note ?? "—"], ["Ordered", <DateTimeText key="a" at={o.ordered_at} timeZone={tz} />], ["Collected", o.collected_at ? <DateTimeText key="b" at={o.collected_at} timeZone={tz} /> : "Not yet"]]} />
          {o.status === "ordered" ? <form action={collectSpecimen} className="mt-5"><input type="hidden" name="order_id" value={id} /><SubmitButton>Mark collected and assign accession</SubmitButton></form> : null}
        </Card>
        <Card title={draft ? "Result waiting for review" : amending ? "Amend result" : "Enter result"}>
          {draft ? (
            <>
              <p className="mb-3"><strong>{draft.value}</strong> {draft.unit} <Badge visual={FLAG[draft.flag as keyof typeof FLAG]} size="sm" /> {draft.reference_range ? <span className="text-ink-500">(ref {draft.reference_range})</span> : null}</p>
              {draft.amendment_reason ? <p className="mb-3 text-sm">Amendment reason: {draft.amendment_reason}</p> : null}
              {draft.entered_by === session.userId ? <Alert tone="info" title="Another person must review this">You entered this result, so you can't publish it.</Alert> : (
                <form action={publishResult}><input type="hidden" name="order_id" value={id} /><SubmitButton pendingLabel="Publishing…">Confirm reviewed and publish</SubmitButton>
                  <p className="mt-2 text-sm text-ink-500">Publishing makes this visible to cliniciansand notifies the ordering doctor. It cannot be undone; later changes are amendments.</p></form>)}
            </>
          ) : canEnter ? (
            <form action={enterResult} className="grid gap-4">
              <input type="hidden" name="order_id" value={id} />
              <TextField label="Result" id="r-value" name="value" />
              <div className="grid grid-cols-2 gap-4"><TextField label="Unit" id="r-unit" name="unit" optional /><TextField label="Reference range" id="r-range" name="reference_range" optional /></div>
              <SelectField label="Flag" id="r-flag" name="flag"><option value="normal">Normal</option><option value="abnormal">Abnormal</option><option value="critical">Critical (needs doctor acknowledgement)</option></SelectField>
              <TextField label="Note" id="r-note" name="note" optional />
              {amending ? <TextField label="Reason for amendment" id="r-amend" name="amend_reason" /> : null}
              <SubmitButton>Save for review</SubmitButton>
            </form>
          ) : <p className="text-ink-700">{o.status === "ordered" ? "Collect the specimen first." : "Nothing to do."}</p>}
        </Card>
        <Card title="Result history" className="lg:col-span-2">
          {rs.length === 0 ? <p className="text-ink-700">No results yet.</p> : (
            <ul className="divide-y divide-line">{rs.map((r) => (
              <li key={r.id} className="py-3"><strong>v{r.version}</strong> {r.value} {r.unit} <Badge visual={FLAG[r.flag as keyof typeof FLAG]} size="sm" /> · {r.state}
                <br /><span className="text-sm text-ink-500">Entered <DateTimeText at={r.entered_at} timeZone={tz} />{r.published_at ? <> · published <DateTimeText at={r.published_at} timeZone={tz} /></> : null}{r.acknowledged_at ? <> · acknowledged <DateTimeText at={r.acknowledged_at} timeZone={tz} /></> : null}{r.amendment_reason ? ` · amended: ${r.amendment_reason}` : ""}</span></li>))}</ul>)}
        </Card>
      </div>
    </>
  );
}
