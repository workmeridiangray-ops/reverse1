import { plat } from "@/lib/server/db";
import { requirePlatform } from "@/lib/server/auth";
import { Page, Card, DataTable, Badge, Hidden, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { retryJobAction, retryWebhook } from "../actions";
export const metadata = { title: "Operations" };
export default async function P() {
  await requirePlatform("techops", "billing");
  const jobs = (await plat("select * from jobs where status in ('failed','dead','running') or (status='queued' and attempts>0) order by created_at desc limit 40")).rows;
  const hooks = (await plat("select * from webhook_events order by received_at desc limit 30")).rows;
  const mail = (await plat("select * from email_outbox where status<>'sent' order by created_at desc limit 20")).rows;
  return <Page title="Jobs, webhooks & email" sub="Processing failures with safe retry. Retried jobs are de-duplicated; payment callbacks are idempotent.">
    <Card title="Failed / retrying jobs (metadata only — no customer documents)"><DataTable rows={jobs} empty="No failed jobs." cols={[{ h: "Kind", r: (r: any) => r.kind }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "Attempts", r: (r: any) => `${r.attempts}/${r.max_attempts}`, num: true }, { h: "Error", r: (r: any) => <span className="text-xs">{r.last_error ?? "—"}</span> }, { h: "", r: (r: any) => ["failed", "dead"].includes(r.status) ? <ActionForm action={retryJobAction} submit="Retry" small><Hidden name="id" value={r.id} /></ActionForm> : null }]} /></Card>
    <Card title="Payment webhook log" className="mt-4"><DataTable rows={hooks} empty="No events." cols={[{ h: "When", r: (r: any) => dt(r.received_at) }, { h: "Provider", r: (r: any) => r.provider, hideSm: true }, { h: "Event", r: (r: any) => <code className="text-xs">{r.event_id}</code> }, { h: "Signature", r: (r: any) => (r.signature_ok ? "valid" : <span className="text-danger">invalid</span>) }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "Error", r: (r: any) => <span className="text-xs">{r.error ?? ""}</span>, hideSm: true }, { h: "", r: (r: any) => r.status === "failed" ? <ActionForm action={retryWebhook} submit="Reprocess" small><Hidden name="id" value={r.id} /></ActionForm> : null }]} /></Card>
    <Card title="Undelivered email" className="mt-4"><DataTable rows={mail} empty="Outbox is clear." cols={[{ h: "To", r: (r: any) => r.to_email }, { h: "Subject", r: (r: any) => r.subject }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "Error", r: (r: any) => <span className="text-xs">{r.last_error ?? ""}</span> }]} /></Card></Page>;
}
