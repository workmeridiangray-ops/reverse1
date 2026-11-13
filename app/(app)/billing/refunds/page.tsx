import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { TextField } from "@/components/ui/Field";
import { DateTimeText, Money } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { decideRefund } from "../finance-actions";

export const metadata: Metadata = { title: "Refunds" };
export const dynamic = "force-dynamic";
const VIS = { requested: { tone: "warn", icon: "hourglass", label: "Awaiting approval" }, approved: { tone: "ok", icon: "check", label: "Approved" }, rejected: { tone: "neutral", icon: "x", label: "Rejected" } } as const;

export default async function Refunds({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin", "receptionist");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("refunds").select("*").order("requested_at", { ascending: false }).limit(200);
  const rows = data ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.patient_id]))];
  const people = ids.length ? (await supabase.from("patients").select("id, given_name, family_name, mrn").in("id", ids)).data ?? [] : [];
  const staff = (await supabase.from("profiles").select("id, full_name")).data ?? [];
  const pn = new Map(people.map((p) => [p.id, `${p.given_name} ${p.family_name} (${p.mrn})`]));
  const sn = new Map(staff.map((p) => [p.id, p.full_name]));
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow="Billing" title="Refunds" description="Every refund needs a reason and a second person's approval." />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="No refunds yet">Request one from an invoice or a deposit.</EmptyState> : (
          <Table caption="Refund requests">
            <thead><tr><Th>Patient</Th><Th>For</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th>Status</Th><Th><span className="sr-only">Decision</span></Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <Td>{pn.get(r.patient_id) ?? "—"}</Td>
                <Td>{r.invoice_id ? <Link href={`/billing/${r.invoice_id}`}>Invoice</Link> : "Deposit"}</Td>
                <Td className="text-right"><Money minor={Number(r.amount_minor)} currency={session.clinic.currency} /></Td>
                <Td>{r.reason}<br /><span className="text-caption text-ink-500">Requested by {sn.get(r.requested_by) ?? "—"} · <DateTimeText at={r.requested_at} timeZone={tz} /></span></Td>
                <Td><Badge visual={VIS[r.status as keyof typeof VIS]} size="sm" />{r.decided_by ? <><br /><span className="text-caption text-ink-500">{sn.get(r.decided_by)}{r.decision_reason ? ` · ${r.decision_reason}` : ""}</span></> : null}</Td>
                <Td>{r.status === "requested" && session.role === "admin" ? (
                  r.requested_by === session.userId ? <span className="text-sm text-ink-500">Another admin must decide</span> : (
                    <form action={decideRefund} className="flex flex-col gap-2"><input type="hidden" name="refund_id" value={r.id} />
                      <TextField label="Reason (required to reject)" id={`rr-${r.id}`} name="reason" optional />
                      <div className="flex gap-2"><button name="decision" value="approve" className="min-h-touch rounded border border-brand-700 bg-brand-700 px-3 font-bold text-white">Approve</button>
                        <button name="decision" value="reject" className="min-h-touch rounded border border-ink-500 px-3 font-bold">Reject</button></div></form>)) : null}</Td>
              </tr>))}</tbody>
          </Table>)}
      </Card>
    </>
  );
}
