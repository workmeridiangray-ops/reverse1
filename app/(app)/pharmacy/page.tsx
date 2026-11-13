import type { Metadata } from "next";
import Link from "next/link";
import { DateText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pharmacy" };
export const dynamic = "force-dynamic";

export default async function PharmacyHome() {
  const session = await requireRole("pharmacist", "admin");
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const [rx, expiring, pendingReturns] = await Promise.all([
    supabase.from("prescriptions").select("id, drug_name, dose, route, frequency, quantity, created_at, patient_id").eq("status", "active").order("created_at").limit(100),
    supabase.from("stock_batches").select("id, batch_no, expiry_date, on_hand_qty, status").neq("status", "disposed").gt("on_hand_qty", 0).lte("expiry_date", soon).order("expiry_date"),
    supabase.from("stock_returns").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const rows = rx.data ?? [];
  const pts = rows.length ? (await supabase.from("patients").select("id, given_name, family_name, mrn").in("id", [...new Set(rows.map((r) => r.patient_id))])).data ?? [] : [];
  const pn = new Map(pts.map((p) => [p.id, `${p.given_name} ${p.family_name} (${p.mrn})`]));
  const exp = expiring.data ?? [];
  const expired = exp.filter((b) => b.expiry_date < today);
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Pharmacy" actions={<Link href="/pharmacy/stock" className="font-bold">Stock, batches and returns</Link>} />
      <div className="mb-gutter flex flex-col gap-3">
        {expired.length ? <Alert tone="danger" title={`${expired.length} expired batch${expired.length > 1 ? "es" : ""} still holding stock`}>They cannot be dispensed. <Link href="/pharmacy/stock">Dispose of them</Link>.</Alert> : null}
        {pendingReturns.count ? <Alert tone="warn" title={`${pendingReturns.count} return${pendingReturns.count > 1 ? "s" : ""} waiting for review`}><Link href="/pharmacy/stock">Review returns</Link></Alert> : null}
        {exp.length - expired.length ? <Alert tone="info" title={`${exp.length - expired.length} batch(es) expire within 60 days`}>Dispense these first.</Alert> : null}
      </div>
      <Card title="Prescription queue">
        {rows.length === 0 ? <EmptyState title="Nothing waiting" /> : (
          <Table caption="Active prescriptions">
            <thead><tr><Th>Patient</Th><Th>Medicine</Th><Th>Directions</Th><Th>Qty</Th><Th>Written</Th></tr></thead>
            <tbody>{rows.map((r) => (<tr key={r.id}>
              <Td><Link href={`/pharmacy/prescriptions/${r.id}`} className="font-bold">{pn.get(r.patient_id)}</Link></Td><Td>{r.drug_name}</Td>
              <Td>{r.dose}, {r.route}, {r.frequency}</Td><Td className="font-mono">{r.quantity ?? "not set"}</Td><Td><DateText at={r.created_at} timeZone={session.clinic.timezone} /></Td></tr>))}</tbody>
          </Table>)}
      </Card>
    </>
  );
}
