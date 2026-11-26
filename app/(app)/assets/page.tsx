import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordService, registerAsset, reportFault, resolveMaintenance, retireAsset, startMaintenance } from "../purchasing/actions";

export const metadata: Metadata = { title: "Assets" };
export const dynamic = "force-dynamic";
const ST = { in_service: { tone: "ok", icon: "check", label: "In service" }, under_maintenance: { tone: "warn", icon: "wrench", label: "Under maintenance" }, retired: { tone: "neutral", icon: "x", label: "Retired" } } as const;

export default async function Assets({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireSession();
  if (session.role === "patient") return null;
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const admin = session.role === "admin";
  const today = new Date().toISOString().slice(0, 10);
  const [assets, reqs, staff] = await Promise.all([
    supabase.from("assets").select("*").order("tag"),
    supabase.from("maintenance_requests").select("*").order("reported_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const an = new Map((assets.data ?? []).map((a) => [a.id, a]));
  const sn = new Map((staff.data ?? []).map((s) => [s.id, s.full_name]));
  const live = (assets.data ?? []).filter((a) => a.status !== "retired");
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Assets and maintenance" />
      <div className="mb-gutter flex flex-col gap-3">{error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}{ok ? <Alert tone="ok" title={ok} /> : null}</div>
      <div className="grid gap-gutter xl:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-gutter">
          <Card title="Asset register">{(assets.data ?? []).length === 0 ? <EmptyState title="No assets registered" /> : (
            <Table caption="Assets"><thead><tr><Th>Tag</Th><Th>Name</Th><Th>Where</Th><Th>Status</Th><Th>Next service</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>{(assets.data ?? []).map((a) => { const overdue = a.next_service_due && a.next_service_due < today && a.status !== "retired"; return (<tr key={a.id}>
                <Td className="font-mono">{a.tag}</Td><Td>{a.name}</Td><Td>{a.location ?? "—"}</Td><Td><Badge visual={ST[a.status as keyof typeof ST]} size="sm" /></Td>
                <Td>{a.next_service_due ?? "—"}{overdue ? <> <Badge visual={{ tone: "danger", icon: "alert", label: "Overdue" }} size="sm" /></> : null}</Td>
                <Td>{admin && a.status !== "retired" ? (<details><summary className="cursor-pointer font-bold text-brand-700">Manage</summary><div className="mt-2 grid w-60 gap-2">
                  <form action={recordService} className="grid gap-2"><input type="hidden" name="asset_id" value={a.id} /><TextField label="Next service date" id={`ns-${a.id}`} name="next" type="date" /><SubmitButton size="sm" variant="secondary">Record service done</SubmitButton></form>
                  <form action={retireAsset} className="grid gap-2"><input type="hidden" name="asset_id" value={a.id} /><TextField label="Reason to retire" id={`rt-${a.id}`} name="reason" /><SubmitButton size="sm" variant="ghost">Retire</SubmitButton></form></div></details>) : null}</Td></tr>); })}</tbody></Table>)}</Card>
          <Card title={admin ? "Maintenance queue" : "My fault reports"}>{(reqs.data ?? []).length === 0 ? <EmptyState title="No faults reported" /> : (
            <ul className="divide-y divide-line">{(reqs.data ?? []).map((m) => (<li key={m.id} className="py-3"><span className="font-bold">{an.get(m.asset_id)?.tag} {an.get(m.asset_id)?.name}</span> · {m.priority} · {m.status.replace("_", " ")}
              <p>{m.issue}</p><p className="text-sm text-ink-500">{sn.get(m.reported_by)} · <DateTimeText at={m.reported_at} timeZone={tz} />{m.downtime_minutes != null ? ` · downtime ${m.downtime_minutes} min` : ""}{m.resolution ? ` · ${m.resolution}` : ""}</p>
              {admin && m.status === "open" ? <form action={startMaintenance} className="mt-1"><input type="hidden" name="req_id" value={m.id} /><SubmitButton size="sm" variant="secondary">Start work</SubmitButton></form> : null}
              {admin && m.status === "in_progress" ? <form action={resolveMaintenance} className="mt-1 flex items-end gap-2"><input type="hidden" name="req_id" value={m.id} /><TextField label="What was done" id={`rs-${m.id}`} name="resolution" /><SubmitButton size="sm">Resolve</SubmitButton></form> : null}</li>))}</ul>)}</Card>
        </div>
        <div className="flex flex-col gap-gutter">
          <Card title="Report a fault"><form action={reportFault} className="grid gap-3"><SelectField label="Asset" id="rf-asset" name="asset_id"><option value="">Choose…</option>{live.map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name}</option>)}</SelectField>
            <TextField label="What is wrong?" id="rf-issue" name="issue" /><SelectField label="Priority" id="rf-pri" name="priority"><option value="normal">Normal</option><option value="urgent">Urgent</option></SelectField><SubmitButton>Report fault</SubmitButton></form></Card>
          {admin ? <Card title="Register an asset"><form action={registerAsset} className="grid gap-3"><TextField label="Tag" id="ra-tag" name="tag" hint="e.g. MON-002" /><TextField label="Name" id="ra-name" name="name" /><TextField label="Category" id="ra-cat" name="category" defaultValue="equipment" /><TextField label="Location" id="ra-loc" name="location" optional /><TextField label="Next service due" id="ra-next" name="next_service" type="date" optional /><SubmitButton variant="secondary">Register</SubmitButton></form></Card> : null}
        </div>
      </div>
    </>
  );
}
