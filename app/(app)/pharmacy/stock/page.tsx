import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getStock } from "@/lib/data/pharmacy";
import { batchState, expiryBand } from "@/lib/rules/dispensing";
import { DRUG_CLASS_LABEL, DRUG_CLASSES } from "@/lib/rules/drug-catalog";
import { needsWriteOff, summarizeStock } from "@/lib/rules/stock";
import { addDays } from "@/lib/rules/dispensing";
import { localDateKey } from "@/lib/rules/time";
import { BATCH_STATE_VISUAL, EXPIRY_BAND_VISUAL, STOCK_LEVEL_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { addProduct, receiveStock, setBatchStatus, writeOff } from "../actions";

export const metadata: Metadata = { title: "Stock" };
export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("pharmacist");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const stock = await getStock(supabase);
  const today = localDateKey(new Date(), session.clinic.timezone);

  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Stock and batches" description="On-hand comes from the stock ledger: every receipt, dispense and write-off is recorded and can't be edited." />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <div className="grid gap-gutter xl:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-gutter">
          {stock.length === 0 ? <EmptyState title="No products yet">Add one on the right.</EmptyState> : stock.map((p) => {
            const s = summarizeStock(p.batches, p.reorderLevel, today);
            return (
              <Card key={p.id} title={p.name} actions={<Badge visual={s.outOfStock ? STOCK_LEVEL_VISUAL.out : s.belowReorder ? STOCK_LEVEL_VISUAL.low : STOCK_LEVEL_VISUAL.ok} size="sm" />}>
                <p className="mb-4 text-sm text-ink-700">
                  <strong className="font-mono text-lg text-ink-900">{s.usable}</strong> {p.unit}s usable · reorder at {p.reorderLevel}
                  {s.expiringSoon > 0 ? <> · <span className="text-warn-fg">{s.expiringSoon} expire within 30 days</span></> : null}
                  {s.expired > 0 ? <> · <span className="font-bold text-danger-fg">{s.expired} expired, to write off</span></> : null}
                  {s.quarantined > 0 ? <> · {s.quarantined} quarantined</> : null}
                </p>
                {p.batches.length === 0 ? <p className="text-ink-500">No batches received.</p> : (
                  <Table caption={`Batches of ${p.name}, earliest expiry first`}>
                    <thead><tr><Th>Batch</Th><Th>Expires</Th><Th className="text-right">On hand</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                    <tbody>
                      {p.batches.map((b) => {
                        const st = batchState(b, today);
                        return (
                          <tr key={b.id}>
                            <Td className="font-mono font-bold"><Link href={`/pharmacy/stock/${b.id}`}>{b.batchNumber}</Link>{b.supplier ? <span className="block font-sans text-caption font-normal text-ink-500">{b.supplier}</span> : null}</Td>
                            <Td><span className="font-mono">{b.expiryDate}</span><span className="mt-1 block"><Badge visual={EXPIRY_BAND_VISUAL[expiryBand(b.expiryDate, today)]} size="sm" /></span></Td>
                            <Td className="text-right font-mono">{b.onHand}<span className="block text-caption text-ink-500">of {b.received}</span></Td>
                            <Td><Badge visual={BATCH_STATE_VISUAL[st]} size="sm" />{b.statusNote ? <p className="mt-1 max-w-[16rem] text-sm text-ink-700">{b.statusNote}</p> : null}</Td>
                            <Td>
                              <div className="flex flex-col items-end gap-2">
                                {needsWriteOff(b, today) ? (
                                  <form action={writeOff} className="flex items-center gap-2">
                                    <input type="hidden" name="id" value={b.id} /><input type="hidden" name="quantity" value={b.onHand} /><input type="hidden" name="note" value="Expired stock disposed" />
                                    <Button type="submit" size="sm" variant="danger">Write off {b.onHand}<span className="sr-only"> from batch {b.batchNumber}</span></Button>
                                  </form>
                                ) : null}
                                {b.status === "available" && st !== "expired" ? (
                                  <details className="text-right">
                                    <summary className="cursor-pointer text-sm font-bold text-brand-700">Quarantine or recall</summary>
                                    <form action={setBatchStatus} className="mt-2 flex flex-col gap-2 text-left">
                                      <input type="hidden" name="id" value={b.id} />
                                      <TextField label="Why?" name="note" id={`note-${b.id}`} maxLength={200} />
                                      <div className="flex gap-2">
                                        <Button type="submit" name="status" value="quarantined" size="sm" variant="secondary">Quarantine</Button>
                                        <Button type="submit" name="status" value="recalled" size="sm" variant="danger">Recall</Button>
                                      </div>
                                    </form>
                                  </details>
                                ) : null}
                                {b.status === "quarantined" ? (
                                  <form action={setBatchStatus}><input type="hidden" name="id" value={b.id} /><Button type="submit" name="status" value="available" size="sm" variant="secondary">Release<span className="sr-only"> batch {b.batchNumber}</span></Button></form>
                                ) : null}
                              </div>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
        <div className="flex flex-col gap-gutter">
          <Card title="Receive a batch" as="aside">
            <form action={receiveStock} className="flex flex-col gap-4">
              <SelectField label="Product" name="product_id" id="recv_product" defaultValue="">
                <option value="" disabled>Choose…</option>
                {stock.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
              <TextField label="Batch number" name="batch_number" id="recv_batch" maxLength={40} />
              <TextField label="Last day of use (expiry)" name="expiry_date" id="recv_expiry" type="date" min={addDays(today, 1)} />
              <TextField label="Quantity received" name="quantity" id="recv_qty" inputMode="numeric" />
              <TextField label="Supplier" name="supplier" id="recv_supplier" optional maxLength={120} />
              <div><Button type="submit" variant="primary" icon="plus">Receive stock</Button></div>
            </form>
          </Card>
          <Card title="Add a product" as="aside">
            <form action={addProduct} className="flex flex-col gap-4">
              <TextField label="Name and strength" name="name" id="prod_name" maxLength={120} hint="e.g. Amoxicillin 500 mg capsules" />
              <TextField label="Unit" name="unit" id="prod_unit" optional maxLength={20} hint="tablet, capsule, ml…" />
              <SelectField label="Drug class" name="drug_class" id="prod_class" optional hint="Lets the system catch a wrong product and match allergies.">
                <option value="">Not classified</option>
                {DRUG_CLASSES.map((c) => <option key={c} value={c}>{DRUG_CLASS_LABEL[c]}</option>)}
              </SelectField>
              <TextField label="Reorder level" name="reorder_level" id="prod_reorder" inputMode="numeric" defaultValue="0" />
              <div><Button type="submit" variant="secondary" icon="plus">Add product</Button></div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
