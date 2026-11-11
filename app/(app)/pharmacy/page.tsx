import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getDispensingQueue, getRecentDispenses, getStock } from "@/lib/data/pharmacy";
import type { StoredAllergyStatus } from "@/lib/rules/allergy";
import { needsWriteOff, summarizeStock } from "@/lib/rules/stock";
import { localDateKey } from "@/lib/rules/time";
import { ALLERGY_CHECK_VISUAL, DISPENSE_FLAG_VISUAL, STOCK_LEVEL_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dispensing" };
export const dynamic = "force-dynamic";

export default async function PharmacyHome({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const session = await requireRole("pharmacist");
  const { ok } = await searchParams;
  const supabase = await createClient();
  const [queue, stock, recent] = await Promise.all([getDispensingQueue(supabase), getStock(supabase), getRecentDispenses(supabase)]);
  const tz = session.clinic.timezone;
  const today = localDateKey(new Date(), tz);
  const alerts = stock.filter((p) => p.active).map((p) => ({ p, s: summarizeStock(p.batches, p.reorderLevel, today) }));
  const expiredOnShelf = stock.flatMap((p) => p.batches.filter((b) => needsWriteOff(b, today)).map((b) => ({ p, b })));
  const lowOrOut = alerts.filter((a) => a.s.belowReorder);

  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Dispensing" description={`${queue.length} prescription${queue.length === 1 ? "" : "s"} waiting`}
        actions={<ButtonLink href="/pharmacy/stock">Stock and batches</ButtonLink>} />
      {ok ? <div className="mb-gutter"><Alert tone="ok" title={ok} /></div> : null}
      <div className="grid gap-gutter xl:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-gutter">
          <Card title="Waiting to be dispensed">
            {queue.length === 0 ? <EmptyState title="Nothing waiting">Prescriptions from doctors appear here.</EmptyState> : (
              <Table caption="Active prescriptions waiting to be dispensed, oldest first">
                <thead><tr><Th>Patient</Th><Th>Medicine</Th><Th>Directions</Th><Th>Allergy check</Th><Th><span className="sr-only">Dispense</span></Th></tr></thead>
                <tbody>
                  {queue.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-bold">{r.patient?.given_name} {r.patient?.family_name}<span className="block font-mono text-sm font-normal text-ink-500">{r.patient?.mrn}</span></Td>
                      <Td>{r.drug_name}</Td>
                      <Td className="text-sm">{r.dose}, {r.route}, {r.frequency}{r.duration_days ? `, ${r.duration_days} days` : ""}</Td>
                      <Td>
                        <Badge visual={ALLERGY_CHECK_VISUAL[r.allergy_check_status as StoredAllergyStatus]} size="sm" />
                        {r.allergy_override_reason ? <p className="mt-1 max-w-xs text-sm"><span className="font-bold">Prescriber&apos;s reason: </span>{r.allergy_override_reason}</p> : null}
                      </Td>
                      <Td className="text-right"><ButtonLink href={`/pharmacy/dispense/${r.id}`} variant="primary" size="sm">Dispense<span className="sr-only"> {r.drug_name} for {r.patient?.given_name} {r.patient?.family_name}</span></ButtonLink></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card title="Recently dispensed">
            {recent.length === 0 ? <p className="text-ink-500">Nothing dispensed yet.</p> : (
              <Table caption="The ten most recent dispenses">
                <thead><tr><Th>When</Th><Th>Patient</Th><Th>Product</Th><Th className="text-right">Qty</Th><Th>Flags</Th></tr></thead>
                <tbody>
                  {recent.map((d) => (
                    <tr key={d.id}>
                      <Td className="text-sm"><DateText at={d.dispensed_at} timeZone={tz} /></Td>
                      <Td>{d.patient?.given_name} {d.patient?.family_name}</Td>
                      <Td className="text-sm">{d.product?.name}</Td>
                      <Td className="text-right font-mono">{d.quantity}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {d.mid_course ? <Badge visual={DISPENSE_FLAG_VISUAL.midCourse} size="sm" /> : null}
                          {d.fefo_skipped ? <Badge visual={DISPENSE_FLAG_VISUAL.fefoSkipped} size="sm" /> : null}
                          {d.allergy_flagged ? <Badge visual={DISPENSE_FLAG_VISUAL.allergy} size="sm" /> : null}
                        </div>
                        {d.pharmacist_note ? <p className="mt-1 max-w-xs text-sm text-ink-700">{d.pharmacist_note}</p> : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card title="Stock needing attention" as="aside">
          {lowOrOut.length === 0 && expiredOnShelf.length === 0 ? <p className="flex items-center gap-2"><Badge visual={STOCK_LEVEL_VISUAL.ok} size="sm" /> Nothing to chase today.</p> : (
            <ul className="flex flex-col gap-4">
              {lowOrOut.map(({ p, s }) => (
                <li key={p.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{p.name}</span><Badge visual={s.outOfStock ? STOCK_LEVEL_VISUAL.out : STOCK_LEVEL_VISUAL.low} size="sm" /></div>
                  <p className="text-sm text-ink-700">{s.usable} usable, reorder at {p.reorderLevel}</p>
                </li>
              ))}
              {expiredOnShelf.map(({ p, b }) => (
                <li key={b.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{p.name}</span><Badge visual={{ tone: "danger", icon: "ban", label: "Expired on shelf" }} size="sm" /></div>
                  <p className="text-sm text-ink-700">Batch <span className="font-mono">{b.batchNumber}</span>: {b.onHand} to write off</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4"><Link href="/pharmacy/stock">Manage stock</Link></p>
        </Card>
      </div>
    </>
  );
}
