import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { PROCEDURE_VISUAL as ST } from "@/lib/ui/status";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Theatre" };
export const dynamic = "force-dynamic";

export default async function Theatre() {
  const session = await requireRole("admin", "doctor", "nurse");
  const supabase = await createClient();
  const [procs, rooms] = await Promise.all([
    supabase.from("procedures").select("id, patient_id, surgeon_id, name, urgency, status, room_id, starts_at, ends_at").neq("status", "cancelled").order("starts_at", { nullsFirst: true }).limit(200),
    supabase.from("rooms").select("id, name").eq("kind", "procedure"),
  ]);
  const rows = procs.data ?? [];
  const pts = rows.length ? (await supabase.from("patients").select("id, given_name, family_name, mrn").in("id", [...new Set(rows.map((r) => r.patient_id))])).data ?? [] : [];
  const docs = (await supabase.from("profiles").select("id, full_name").eq("role", "doctor")).data ?? [];
  const pn = new Map(pts.map((p) => [p.id, `${p.given_name} ${p.family_name} (${p.mrn})`]));
  const dn = new Map(docs.map((d) => [d.id, d.full_name]));
  const rn = new Map((rooms.data ?? []).map((r) => [r.id, r.name]));
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Theatre" actions={session.role === "doctor" ? <ButtonLink href="/theatre/new" variant="primary" icon="plus">Request procedure</ButtonLink> : null} />
      <Card>{rows.length === 0 ? <EmptyState title="No procedures" /> : (
        <Table caption="Procedures">
          <thead><tr><Th>When</Th><Th>Procedure</Th><Th>Patient</Th><Th>Theatre</Th><Th>Surgeon</Th><Th>Status</Th></tr></thead>
          <tbody>{rows.map((r) => (<tr key={r.id}>
            <Td>{r.starts_at ? <DateTimeText at={r.starts_at} timeZone={tz} /> : "—"}</Td>
            <Td><Link href={`/theatre/${r.id}`} className="font-bold">{r.name}</Link>{r.urgency !== "elective" ? ` · ${r.urgency}` : ""}</Td>
            <Td>{pn.get(r.patient_id)}</Td><Td>{r.room_id ? rn.get(r.room_id) : "—"}</Td><Td>{dn.get(r.surgeon_id)}</Td><Td><Badge visual={ST[r.status as keyof typeof ST]} size="sm" /></Td></tr>))}</tbody>
        </Table>)}</Card>
    </>
  );
}
