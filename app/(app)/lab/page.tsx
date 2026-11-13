import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Laboratory" };
export const dynamic = "force-dynamic";

export default async function Lab() {
  const session = await requireRole("lab", "admin");
  const supabase = await createClient();
  const [orders, drafts, overdue] = await Promise.all([
    supabase.from("lab_orders").select("id, patient_id, test_name, kind, priority, status, accession, ordered_at").in("status", ["ordered", "collected", "resulted"]).order("priority", { ascending: false }).order("ordered_at"),
    supabase.from("lab_results").select("order_id").eq("state", "draft"),
    supabase.from("overdue_critical_results").select("order_id, test_name, published_at"),
  ]);
  const rows = orders.data ?? [];
  const pts = rows.length ? (await supabase.from("patients").select("id, given_name, family_name, mrn").in("id", [...new Set(rows.map((r) => r.patient_id))])).data ?? [] : [];
  const pn = new Map(pts.map((p) => [p.id, `${p.given_name} ${p.family_name} (${p.mrn})`]));
  const drafted = new Set((drafts.data ?? []).map((d) => d.order_id));
  const groups: Array<[string, typeof rows]> = [
    ["To collect", rows.filter((r) => r.status === "ordered")],
    ["Collected, awaiting result", rows.filter((r) => r.status === "collected")],
    ["Awaiting review", rows.filter((r) => r.status === "resulted" && drafted.has(r.id))],
  ];
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Laboratory and imaging" description="Manual result entry. Every result is reviewed by a second person before clinicians can see it." />
      {(overdue.data ?? []).length ? (
        <div className="mb-gutter"><Alert tone="danger" title="Critical results not yet acknowledged">
          <ul>{(overdue.data ?? []).map((o) => <li key={o.order_id}><Link href={`/lab/orders/${o.order_id}`}>{o.test_name}</Link> · published <DateTimeText at={o.published_at!} timeZone={tz} /></li>)}</ul>
          Phone the ordering doctor, then record the call in the result note.</Alert></div>) : null}
      <div className="grid gap-gutter lg:grid-cols-3">
        {groups.map(([title, list]) => (
          <Card key={title} title={`${title} (${list.length})`}>
            {list.length === 0 ? <EmptyState title="Nothing here" /> : (
              <ul className="divide-y divide-line">{list.map((o) => (
                <li key={o.id} className="py-3"><Link href={`/lab/orders/${o.id}`} className="font-bold">{o.test_name}</Link>{" "}
                  {o.priority === "urgent" ? <Badge visual={{ tone: "danger", icon: "flag", label: "Urgent" }} size="sm" /> : null}
                  <br /><span className="text-sm text-ink-500">{pn.get(o.patient_id)} · {o.kind}{o.accession ? ` · ${o.accession}` : ""} · <DateTimeText at={o.ordered_at} timeZone={tz} /></span></li>))}</ul>)}
          </Card>))}
      </div>
    </>
  );
}
