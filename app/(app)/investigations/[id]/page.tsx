import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { acknowledgeCritical, cancelOrder } from "../../lab/actions";

export const metadata: Metadata = { title: "Investigation" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAG = { normal: { tone: "ok", icon: "check", label: "Normal" }, abnormal: { tone: "warn", icon: "alert", label: "Abnormal" }, critical: { tone: "critical", icon: "flag", label: "Critical" } } as const;

export default async function Investigation({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("doctor", "nurse", "admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: o } = await supabase.from("lab_orders").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [pt, results] = await Promise.all([
    supabase.from("patients").select("given_name, family_name, mrn, date_of_birth").eq("id", o.patient_id).single(),
    supabase.from("lab_results").select("*").eq("order_id", id).order("version", { ascending: false }),
  ]);
  const rs = results.data ?? [];
  const cur = rs.find((r) => r.state === "published");
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={`Investigation${o.accession ? ` · ${o.accession}` : ""}`} title={o.test_name} description={<>{pt.data?.given_name} {pt.data?.family_name} · {pt.data?.mrn} · DOB {pt.data?.date_of_birth}</>} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {cur?.flag === "critical" && !cur.acknowledged_at ? <Alert tone="danger" title="Critical result: acknowledgement required">Review the result and record that you have acted on it.</Alert> : null}
      </div>
      <div className="grid gap-gutter lg:grid-cols-2">
        <Card title="Result">
          {cur ? (<>
            <p className="text-heading"><strong>{cur.value}</strong> {cur.unit} <Badge visual={FLAG[cur.flag as keyof typeof FLAG]} size="sm" /></p>
            {cur.reference_range ? <p className="text-ink-500">Reference {cur.reference_range}</p> : null}
            {cur.note ? <p className="mt-2">{cur.note}</p> : null}
            <p className="mt-3 text-sm text-ink-500">Version {cur.version} · published <DateTimeText at={cur.published_at!} timeZone={tz} />{cur.version > 1 ? ` · amended: ${cur.amendment_reason}` : ""}</p>
            {cur.flag === "critical" && !cur.acknowledged_at && session.role === "doctor" ? <form action={acknowledgeCritical} className="mt-4"><input type="hidden" name="order_id" value={id} /><SubmitButton variant="danger">I have seen this and acted on it</SubmitButton></form> : null}
            {cur.acknowledged_at ? <p className="mt-3 text-sm">Acknowledged <DateTimeText at={cur.acknowledged_at} timeZone={tz} />.</p> : null}
          </>) : <p className="text-ink-700">{o.status === "cancelled" ? `Cancelled: ${o.cancel_reason}` : "No published result yet. You will be notified when it is ready."}</p>}
        </Card>
        <Card title="Order"><DefinitionList items={[["Status", o.status], ["Priority", o.priority], ["Note", o.clinical_note ?? "—"], ["Ordered", <DateTimeText key="a" at={o.ordered_at} timeZone={tz} />]]} />
          {(o.status === "ordered" || o.status === "collected") && session.role === "doctor" ? (
            <form action={cancelOrder} className="mt-5 flex flex-col gap-3"><input type="hidden" name="order_id" value={id} /><TextField label="Reason for cancelling" id="co-reason" name="reason" /><SubmitButton variant="secondary">Cancel order</SubmitButton></form>) : null}
        </Card>
        {rs.filter((r) => r.state === "superseded").length ? (
          <Card title="Earlier versions" className="lg:col-span-2"><ul>{rs.filter((r) => r.state === "superseded").map((r) => <li key={r.id}>v{r.version}: {r.value} {r.unit} (superseded)</li>)}</ul></Card>) : null}
      </div>
    </>
  );
}
