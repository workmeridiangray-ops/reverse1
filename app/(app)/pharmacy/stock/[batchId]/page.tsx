import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { DateTimeText } from "@/components/ui/Format";
import { Card, DefinitionList, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { getBatchTrace } from "@/lib/data/pharmacy";
import { batchState } from "@/lib/rules/dispensing";
import type { StockBatch } from "@/lib/rules/dispensing";
import { localDateKey } from "@/lib/rules/time";
import { BATCH_STATE_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Batch trace" };
export const dynamic = "force-dynamic";

export default async function BatchTracePage({ params }: { params: Promise<{ batchId: string }> }) {
  const session = await requireRole("pharmacist");
  const { batchId } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("stock_batches")
    .select("id, batch_number, expiry_date, quantity_on_hand, quantity_received, status, status_note, supplier, product:stock_products!stock_batches_product_id_clinic_id_fkey(name)")
    .eq("id", batchId)
    .maybeSingle();
  if (!b) notFound();
  const trace = await getBatchTrace(supabase, batchId);
  // Showing patient names is access to patient records, so each is written to the audit log.
  const patientIds = [...new Set(trace.map((t) => t.dispense?.patient_id).filter((x): x is string => !!x))].slice(0, 100);
  for (const id of patientIds) await logAccess(supabase, "patients", id, `batch trace ${b.batch_number}`);
  const tz = session.clinic.timezone;
  const asBatch: StockBatch = { id: b.id, batchNumber: b.batch_number, expiryDate: b.expiry_date, onHand: b.quantity_on_hand, status: b.status as StockBatch["status"] };
  const given = trace.reduce((n, t) => n + t.quantity, 0);

  return (
    <>
      <PageHeader eyebrow="Batch trace" title={`${b.product?.name} · ${b.batch_number}`}
        description={<>If this batch is recalled, these are the patients to contact. <Link href="/pharmacy/stock">Back to stock</Link></>}
        actions={<Badge visual={BATCH_STATE_VISUAL[batchState(asBatch, localDateKey(new Date(), tz))]} />} />
      <div className="grid gap-gutter lg:grid-cols-[1fr_22rem]">
        <Card title={`Dispensed to ${patientIds.length} patient${patientIds.length === 1 ? "" : "s"}`}>
          {trace.length === 0 ? <EmptyState title="Nothing has been dispensed from this batch" /> : (
            <Table caption="Everyone who received stock from this batch">
              <thead><tr><Th>When</Th><Th>Patient</Th><Th className="text-right">Quantity</Th><Th>Dispensed by</Th></tr></thead>
              <tbody>
                {trace.map((t) => (
                  <tr key={t.id}>
                    <Td className="text-sm">{t.dispense ? <DateTimeText at={t.dispense.dispensed_at} timeZone={tz} /> : ""}</Td>
                    <Td className="font-bold">{t.dispense?.patient?.given_name} {t.dispense?.patient?.family_name}<span className="block font-mono text-sm font-normal text-ink-500">{t.dispense?.patient?.mrn}</span></Td>
                    <Td className="text-right font-mono">{t.quantity}</Td>
                    <Td className="text-sm">{t.dispense?.pharmacist?.full_name}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Batch" as="aside">
          <DefinitionList items={[
            ["Expires", <span key="e" className="font-mono">{b.expiry_date}</span>],
            ["Received", <span key="r" className="font-mono">{b.quantity_received}</span>],
            ["Dispensed", <span key="d" className="font-mono">{given}</span>],
            ["On hand", <span key="o" className="font-mono">{b.quantity_on_hand}</span>],
            ["Supplier", b.supplier ?? "Not recorded"],
            ...(b.status_note ? [["Note", b.status_note] as [string, string]] : []),
          ]} />
        </Card>
      </div>
    </>
  );
}
