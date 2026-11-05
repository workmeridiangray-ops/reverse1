import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requirePlatform } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { retryEmail } from "../actions";

export const metadata = { title: "Background jobs" };
export default async function Jobs() {
  const a = await requirePlatform();
  const rows = await tx({ userId: a.user.id, platform: true }, (db) => db.q<{ id: number; to_email: string; subject: string; status: string; attempts: number; last_error: string | null; created_at: Date }>("SELECT id,to_email,subject,status,attempts,last_error,created_at FROM email_outbox WHERE status <> 'sent' ORDER BY id DESC LIMIT 100"));
  return (<><PageHeader title="Background jobs" description="Outgoing email queue. Message bodies are not shown here because they can contain account links. Failures are retried automatically up to 5 times." />
    {rows.length === 0 ? <EmptyState title="No pending or failed jobs" /> : <Card><Table caption="Email jobs"><thead><tr><Th>Created</Th><Th>To</Th><Th>Subject</Th><Th>Status</Th><Th>Attempts</Th><Th>Error</Th><Th><span className="sr-only">Retry</span></Th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><Td><DateTimeText at={r.created_at} /></Td><Td>{r.to_email}</Td><Td>{r.subject}</Td><Td><Badge status={r.status === "failed" ? "failed" : "pending"} /></Td><Td>{r.attempts}</Td><Td className="max-w-xs break-words text-caption">{r.last_error ?? "—"}</Td><Td>{r.status === "failed" ? <ActionForm action={retryEmail} submitLabel="Retry" variant="secondary"><input type="hidden" name="id" value={r.id} /></ActionForm> : null}</Td></tr>)}</tbody></Table></Card>}</>);
}
