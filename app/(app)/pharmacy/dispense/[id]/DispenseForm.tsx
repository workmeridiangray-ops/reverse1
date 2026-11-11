"use client";
import { useActionState, useMemo, useState } from "react";
import { dispense, type DispenseState } from "@/app/(app)/pharmacy/actions";
import { Badge } from "@/components/ui/Badge";
import { TextAreaField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { type AllergyRecord, checkAllergies } from "@/lib/rules/allergy";
import {
  type Allocation, batchState, expiresMidCourse, expiryBand, flagsFor, noteReasons, planDispense, type StockBatch, validateAllocations,
} from "@/lib/rules/dispensing";
import { BATCH_STATE_VISUAL, DISPENSE_FLAG_VISUAL, EXPIRY_BAND_VISUAL } from "@/lib/ui/status";

interface Props {
  prescriptionId: string;
  productId: string;
  unit: string;
  batches: StockBatch[];
  today: string;
  suggestedQuantity: number | null;
  suggestedCover: number | null;
  prescribedClasses: string[];
  productClasses: string[];
  allergies: AllergyRecord[];
  quantityHint: string;
}

/**
 * Live dispensing plan. All the decisions come from lib/rules/dispensing.ts and
 * lib/rules/allergy.ts: this component only shows them and collects inputs.
 */
export function DispenseForm(p: Props) {
  const [state, action] = useActionState<DispenseState, FormData>(dispense, {});
  const [quantity, setQuantity] = useState(p.suggestedQuantity ?? 0);
  const [cover, setCover] = useState<string>(p.suggestedCover?.toString() ?? "");
  const [avoidMid, setAvoidMid] = useState(false);
  const [manual, setManual] = useState<Record<string, number> | null>(null);

  const coverDays = cover.trim() === "" || !Number.isInteger(Number(cover)) || Number(cover) < 1 ? null : Number(cover);
  const plan = useMemo(
    () => (Number.isInteger(quantity) && quantity > 0 ? planDispense({ batches: p.batches, quantity, today: p.today, coverDays, avoidMidCourse: avoidMid }) : null),
    [p.batches, p.today, quantity, coverDays, avoidMid],
  );
  const allocations: Allocation[] = manual
    ? Object.entries(manual).filter(([, q]) => q > 0).map(([batchId, q]) => ({ batchId, quantity: q }))
    : (plan?.allocations ?? []).map((a) => ({ batchId: a.batchId, quantity: a.quantity }));
  const total = allocations.reduce((n, a) => n + a.quantity, 0);
  const issues = validateAllocations(allocations, p.batches, p.today);
  const flags = flagsFor(allocations, p.batches, p.today, coverDays);
  const allergy = useMemo(() => checkAllergies("", p.allergies, [...p.prescribedClasses, ...p.productClasses]), [p.allergies, p.prescribedClasses, p.productClasses]);
  const reasons = noteReasons(flags, allergy.hasDirectConflict);
  const shortfall = !manual && plan ? plan.shortfall : 0;
  const byId = new Map(p.batches.map((b) => [b.id, b]));
  const allocated = new Map(allocations.map((a) => [a.batchId, a.quantity]));
  const canSubmit = total > 0 && issues.length === 0 && shortfall === 0;

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="prescription_id" value={p.prescriptionId} />
      <input type="hidden" name="product_id" value={p.productId} />
      <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
      {state.formError ? <Alert tone="danger" title="Not dispensed">{state.formError}</Alert> : null}

      <div className="grid gap-5 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="quantity" className="text-sm font-bold">How many {p.unit}s</label>
          <input id="quantity" inputMode="numeric" value={quantity || ""} onChange={(e) => { setManual(null); setQuantity(Number(e.currentTarget.value.replace(/\D/g, "")) || 0); }}
            className="min-h-touch rounded border border-ink-500 bg-surface px-3 font-mono text-lg" />
          <p className="text-caption text-ink-500">{p.quantityHint}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cover_days" className="text-sm font-bold">Days this supply should last</label>
          <input id="cover_days" name="cover_days" inputMode="numeric" value={cover} onChange={(e) => setCover(e.currentTarget.value.replace(/\D/g, ""))}
            className="min-h-touch rounded border border-ink-500 bg-surface px-3 font-mono text-lg" />
          <p className="text-caption text-ink-500">Lets the system warn if a batch expires before the course ends. Leave blank if unknown.</p>
        </div>
        <label className="flex min-h-touch cursor-pointer items-start gap-3 self-end rounded border border-line px-3 py-2">
          <input type="checkbox" checked={avoidMid} onChange={(e) => { setManual(null); setAvoidMid(e.currentTarget.checked); }} className="mt-1 h-5 w-5 accent-brand-700" />
          <span><span className="font-bold">Prefer longer-dated batches</span><span className="block text-caption text-ink-500">Uses a batch that outlasts the course. This departs from first-expiry-first-out, so a note is needed.</span></span>
        </label>
      </div>

      <section aria-labelledby="batches-h" aria-live="polite">
        <h2 id="batches-h" className="mb-2 text-title font-bold">Stock to use</h2>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Batches of this product, earliest expiry first, and how many to take from each</caption>
            <thead><tr className="bg-canvas text-caption font-bold uppercase tracking-wide text-ink-500">
              <th scope="col" className="px-3 py-2">Batch</th><th scope="col" className="px-3 py-2">Expires</th><th scope="col" className="px-3 py-2 text-right">On hand</th>
              <th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2 text-right">Take</th>
            </tr></thead>
            <tbody>
              {[...p.batches].sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : 1)).map((b) => {
                const st = batchState(b, p.today);
                const taken = allocated.get(b.id) ?? 0;
                const mid = taken > 0 && expiresMidCourse(b.expiryDate, p.today, coverDays);
                return (
                  <tr key={b.id} className={`border-t border-line ${taken > 0 ? "bg-brand-50" : ""} ${st !== "usable" ? "text-ink-500" : ""}`}>
                    <td className="px-3 py-3 font-mono font-bold">{b.batchNumber}</td>
                    <td className="px-3 py-3"><span className="font-mono">{b.expiryDate}</span> <Badge visual={EXPIRY_BAND_VISUAL[expiryBand(b.expiryDate, p.today)]} size="sm" /></td>
                    <td className="px-3 py-3 text-right font-mono">{b.onHand}</td>
                    <td className="px-3 py-3"><Badge visual={BATCH_STATE_VISUAL[st]} size="sm" />{mid ? <span className="ml-2"><Badge visual={DISPENSE_FLAG_VISUAL.midCourse} size="sm" /></span> : null}</td>
                    <td className="px-3 py-3 text-right">
                      <label className="sr-only" htmlFor={`take-${b.id}`}>Take from batch {b.batchNumber}</label>
                      <input id={`take-${b.id}`} inputMode="numeric" disabled={st !== "usable"} value={taken || ""} placeholder="0"
                        onChange={(e) => {
                          const n = Number(e.currentTarget.value.replace(/\D/g, "")) || 0;
                          setManual({ ...Object.fromEntries(allocations.map((a) => [a.batchId, a.quantity])), [b.id]: n });
                        }}
                        className="min-h-touch w-24 rounded border border-ink-500 bg-surface px-2 text-right font-mono disabled:bg-sunken" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span>Total <strong className="font-mono">{total}</strong>{!manual && quantity ? <> of <span className="font-mono">{quantity}</span> asked</> : null}</span>
          {manual ? <button type="button" onClick={() => setManual(null)} className="font-bold text-brand-700 underline">Back to the suggested batches</button> : <span className="text-ink-500">Edit the &ldquo;Take&rdquo; column to choose batches by hand.</span>}
        </p>
        {shortfall > 0 ? <div className="mt-3"><Alert tone="danger" title={`Not enough usable stock: ${shortfall} short`}>Expired, quarantined and recalled batches are never offered.</Alert></div> : null}
        {issues.length > 0 && total > 0 ? <div className="mt-3"><Alert tone="danger" title="This choice can't be dispensed"><ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul></Alert></div> : null}
        {allocations.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-700">
            {allocations.map((a) => <li key={a.batchId}>{a.quantity} from batch <span className="font-mono">{byId.get(a.batchId)?.batchNumber}</span> (expires <span className="font-mono">{byId.get(a.batchId)?.expiryDate}</span>)</li>)}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="flags-h" aria-live="polite" className="flex flex-col gap-3">
        <h2 id="flags-h" className="text-title font-bold">Checks</h2>
        {reasons.length === 0 ? <p className="flex items-center gap-2"><Badge visual={{ tone: "ok", icon: "check", label: "No warnings" }} size="sm" /><span className="text-sm text-ink-700">First-expiry-first-out, in date for the whole course, no allergy to this class.</span></p> : null}
        {flags.midCourse ? <Alert tone="warn" title="A batch expires before the course ends">{coverDays ? `The course runs ${coverDays} days from today, but` : "But"} a chosen batch runs out of date part-way through. Use a longer-dated batch, or explain below.</Alert> : null}
        {flags.fefoSkipped ? <Alert tone="warn" title="An earlier-expiry batch was skipped">That batch still has stock. First-expiry-first-out means it should go first, unless there is a reason.</Alert> : null}
        {allergy.hasDirectConflict ? <Alert tone="danger" title="Recorded allergy to this class">{allergy.findings.filter((f) => f.match === "direct").map((f) => f.message).join(" ")}</Alert> : null}
        {!allergy.hasDirectConflict && allergy.findings.length > 0 ? <Alert tone="warn" title="Possible cross-reaction">{allergy.findings.map((f) => f.message).join(" ")}</Alert> : null}
        {allergy.recordState === "not_recorded" ? <Alert tone="warn" title="No allergy record for this patient">Ask the patient before handing it over.</Alert> : null}
        {reasons.length > 0 ? (
          <TextAreaField label="Note (required)" name="note" id="note" rows={3} hint={`Needed because ${reasons.join(" and ")}. At least 10 characters.`} />
        ) : <input type="hidden" name="note" value="" />}
      </section>

      <div className="flex gap-3">
        <SubmitButton pendingLabel="Dispensing…" disabled={!canSubmit}>Dispense {total > 0 ? total : ""}</SubmitButton>
      </div>
    </form>
  );
}
