import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Investigations" };
export const dynamic = "force-dynamic";
const ST = { ordered: { tone: "neutral", icon: "clock", label: "Ordered" }, collected: { tone: "info", icon: "door", label: "Collected" }, resulted: { tone: "info", icon: "hourglass", label: "Being reviewed" }, published: { tone: "ok", icon: "check", label: "Result ready" }, cancelled: { tone: "neutral", icon: "x", label: "Cancelled" } } as const;

export default async function Investigations() {
  const session = await requireRole("doctor", "nurse", "admin");
  const supabase = await createClient();
  const { data } = await supabase.from("lab_orders").select("id, patient_id, test_name, kind, priority, status, ordered_at").order("ordered_at", { ascending: false }).limit(200);
  const rows = data ?? [];
  const pts = rows.length ? (await supabase.from("patients").select("id, given_name, family_name, mrn").in("id", [...new Set(rows.map((r) => r.patient_id))])).data ?? [] : [];
  const pn = new Map(pts.map((p) => [p.id, `${p.given_name} ${p.family_name} (${p.mrn})`]));
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Investigations" actions={session.role === "doctor" ? <ButtonLink href="/investigations/new" variant="primary" icon="plus">Order a test</ButtonLink> : null} />
      <Card>{rows.length === 0 ? <EmptyState title="No orders yet" /> : (
        <Table caption="Investigation orders">
          <thead><tr><Th>Test</Th><Th>Patient</Th><Th>Status</Th><Th>Ordered</Th></tr></thead>
          <tbody>{rows.map((r) => (<tr key={r.id}>
            <Td><Link href={`/investigations/${r.id}`} className="font-bold">{r.test_name}</Link>{r.priority === "urgent" ? " · urgent" : ""} <span className="text-sm text-ink-500">({r.kind})</span></Td>
            <Td>{pn.get(r.patient_id)}</Td><Td><Badge visual={ST[r.status as keyof typeof ST]} size="sm" /></Td><Td><DateTimeText at={r.ordered_at} timeZone={session.clinic.timezone} /></Td></tr>))}</tbody>
        </Table>)}</Card>
    </>
  );
}
