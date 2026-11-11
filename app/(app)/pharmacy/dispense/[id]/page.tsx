import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { getAllergies } from "@/lib/data/clinical";
import { getPrescriptionToDispense, getStock } from "@/lib/data/pharmacy";
import { classesForDrug } from "@/lib/rules/drug-catalog";
import { productMatchesPrescription, suggestSupply } from "@/lib/rules/dispensing";
import type { StoredAllergyStatus } from "@/lib/rules/allergy";
import { localDateKey } from "@/lib/rules/time";
import { ALLERGY_CHECK_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { DispenseForm } from "./DispenseForm";

export const metadata: Metadata = { title: "Dispense" };
export const dynamic = "force-dynamic";

export default async function DispensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ product?: string }> }) {
  const session = await requireRole("pharmacist");
  const { id } = await params;
  const { product: productParam } = await searchParams;
  const supabase = await createClient();
  const rx = await getPrescriptionToDispense(supabase, id);
  if (!rx || !rx.patient) notFound();
  await logAccess(supabase, "prescriptions", id, "dispensing");
  const [stock, allergies] = await Promise.all([getStock(supabase), getAllergies(supabase, rx.patient_id)]);
  const today = localDateKey(new Date(), session.clinic.timezone);

  const classes = rx.drug_classes.length ? rx.drug_classes : classesForDrug(rx.drug_name);
  const firstWord = rx.drug_name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const candidates = stock.filter((p) => p.active && productMatchesPrescription(classes, p.drugClasses) && (classes.length > 0 ? p.drugClasses.some((c) => classes.includes(c)) : p.name.toLowerCase().includes(firstWord)));
  const chosen = stock.find((p) => p.id === productParam && p.active) ?? candidates[0] ?? null;
  const supply = suggestSupply(rx.dose, rx.frequency, rx.duration_days);
  const closed = rx.status !== "active";

  return (
    <>
      <PageHeader eyebrow="Dispensing" title={`${rx.patient.given_name} ${rx.patient.family_name}`}
        description={<><span className="font-mono">{rx.patient.mrn}</span> · <Link href="/pharmacy">Back to the queue</Link></>} />
      {closed ? <div className="mb-gutter"><Alert tone="warn" title={`This prescription is ${rx.status}`}>It can't be dispensed.</Alert></div> : null}
      <div className="grid gap-gutter xl:grid-cols-[1fr_22rem]">
        <Card title="Prescription">
          <DefinitionList items={[
            ["Medicine", <strong key="m">{rx.drug_name}</strong>],
            ["Dose and frequency", `${rx.dose}, ${rx.route}, ${rx.frequency}${rx.duration_days ? `, ${rx.duration_days} days` : ""}`],
            ["Allergy check at prescribing", <Badge key="a" visual={ALLERGY_CHECK_VISUAL[rx.allergy_check_status as StoredAllergyStatus]} size="sm" />],
            ...(rx.allergy_override_reason ? [["Prescriber's reason", rx.allergy_override_reason] as [string, string]] : []),
          ]} />
          <div className="mt-6 border-t border-line pt-6">
            <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="product" className="text-sm font-bold">Product from stock</label>
                <select id="product" name="product" defaultValue={chosen?.id ?? ""} className="min-h-touch min-w-[18rem] rounded border border-ink-500 bg-surface px-3">
                  {(candidates.length ? candidates : stock.filter((p) => p.active)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <Button type="submit" variant="secondary" size="sm">Use this product</Button>
            </form>
            {!chosen ? <Alert tone="warn" title="No matching product in stock records">Add the product on the Stock page first.</Alert> : closed ? null : (
              <DispenseForm
                key={chosen.id}
                prescriptionId={rx.id}
                productId={chosen.id}
                unit={chosen.unit}
                batches={chosen.batches}
                today={today}
                suggestedQuantity={supply?.quantity ?? null}
                suggestedCover={supply?.coverDays ?? rx.duration_days}
                prescribedClasses={classes}
                productClasses={chosen.drugClasses}
                allergies={allergies}
                quantityHint={supply ? `Suggested from "${rx.dose}", ${rx.frequency}, ${supply.coverDays} days.` : `Couldn't work out a quantity from "${rx.dose}": enter it.`}
              />
            )}
          </div>
        </Card>
        <Card title="Allergies on record" as="aside">
          {allergies.length === 0 ? <p className="text-ink-700">Nothing recorded for this patient.</p> : (
            <ul className="flex flex-col gap-2">
              {allergies.map((a) => <li key={a.id}>{a.kind === "nkda" ? <span className="font-bold text-ok-fg">No known drug allergies</span> : <><strong>{a.allergen}</strong>{a.severity ? <span className="text-sm text-ink-700"> · {a.severity}</span> : null}{a.reaction ? <span className="block text-sm text-ink-700">{a.reaction}</span> : null}</>}</li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
