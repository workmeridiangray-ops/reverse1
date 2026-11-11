"use client";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { prescribe, type PrescribeState } from "@/app/(app)/doctor/clinical-actions";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { type AllergyRecord, checkAllergies, MIN_OVERRIDE_REASON_LENGTH } from "@/lib/rules/allergy";
import { DRUG_CLASS_LABEL, DRUG_CLASSES } from "@/lib/rules/drug-catalog";
import { FREQUENCIES, ROUTES } from "@/lib/rules/prescribing";

/**
 * The allergy check runs live in the browser using the SAME pure module the
 * server and database mirror (lib/rules/allergy.ts), so the warning appears
 * as the doctor types, and the server re-checks on submit.
 */
export function PrescribeForm({ consultationId, patientId, allergies, drugNames }: {
  consultationId: string; patientId: string; allergies: AllergyRecord[]; drugNames: string[];
}) {
  const [state, action] = useActionState<PrescribeState, FormData>(prescribe, {});
  const v = (k: string) => state.values?.[k] ?? "";
  const [drug, setDrug] = useState(v("drug_name"));
  const [manual, setManual] = useState(v("drug_class"));
  const check = useMemo(() => checkAllergies(drug, allergies, manual ? [manual] : []), [drug, manual, allergies]);
  const e = state.errors ?? {};
  const typed = drug.trim().length > 0;

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-6" noValidate>
      <input type="hidden" name="consultation_id" value={consultationId} />
      <input type="hidden" name="patient_id" value={patientId} />
      {state.formError ? <Alert tone="danger" title="Not prescribed">{state.formError}</Alert> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <TextField label="Medicine" name="drug_name" value={drug} onChange={(ev) => setDrug(ev.currentTarget.value)} list="drug-suggestions"
            error={e.drugName} autoComplete="off" hint="Start typing, or enter any medicine" />
          <datalist id="drug-suggestions">{drugNames.map((n) => <option key={n} value={n} />)}</datalist>
        </div>
        <TextField label="Dose" name="dose" defaultValue={v("dose")} error={e.dose} placeholder="500 mg" />
        <SelectField label="Route" name="route" defaultValue={v("route") || "oral"} error={e.route}>
          {ROUTES.map((r) => <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}</option>)}
        </SelectField>
        <SelectField label="How often" name="frequency" defaultValue={v("frequency") || "twice daily"} error={e.frequency}>
          {FREQUENCIES.map((f) => <option key={f} value={f}>{f[0]!.toUpperCase() + f.slice(1)}</option>)}
        </SelectField>
        <TextField label="Days" name="duration_days" inputMode="numeric" optional defaultValue={v("duration_days")} error={e.durationDays} hint="Blank for ongoing" />
      </div>

      {/* Allergy check: always visible, never silent. */}
      <section aria-labelledby="allergy-check" aria-live="polite" className="flex flex-col gap-3">
        <h2 id="allergy-check" className="text-title font-bold">Allergy check</h2>
        {!typed ? <p className="text-ink-500">Enter a medicine to check it against this patient&apos;s allergies.</p> : null}
        {typed && check.status === "conflict" ? (
          <Alert tone="danger" title="Allergy warning: a written reason is required">
            <ul className="list-disc pl-5">{check.findings.map((f) => <li key={f.allergyId}>{f.message}</li>)}</ul>
            <p className="mt-2">You can still prescribe it. Say why, and the pharmacist will see your reason.</p>
          </Alert>
        ) : null}
        {typed && check.status === "cross_reactive" ? (
          <Alert tone="warn" title="Possible cross-reaction: a written reason is required">
            <ul className="list-disc pl-5">{check.findings.map((f) => <li key={f.allergyId}>{f.message}</li>)}</ul>
          </Alert>
        ) : null}
        {typed && check.status === "unchecked" ? (
          <Alert tone="warn" title="Allergy check could not run">
            This medicine isn&apos;t in the drug list, so it can&apos;t be matched to an allergy. This is not a clearance. Check by hand, or choose its class below.
          </Alert>
        ) : null}
        {typed && check.status === "no_allergy_record" ? (
          <Alert tone="warn" title="No allergy record for this patient">
            Nothing has been recorded, which doesn&apos;t mean no allergies. Ask the patient and record it on the consultation page.
          </Alert>
        ) : null}
        {typed && check.status === "clear" ? (
          <p className="flex items-center gap-2"><Badge visual={{ tone: "ok", icon: "shield", label: "No recorded allergy matches" }} size="sm" />
            <span className="text-sm text-ink-700">Checked against {allergies.filter((a) => a.kind === "allergy").length} recorded allergies ({check.drugClasses.map((c) => DRUG_CLASS_LABEL[c as keyof typeof DRUG_CLASS_LABEL]).join(", ")}).</span></p>
        ) : null}
        {typed && check.unmatchable.length > 0 ? (
          <p className="text-sm text-warn-fg">Not auto-checked: {check.unmatchable.join(", ")}. Review these yourself.</p>
        ) : null}

        {typed && check.requiresReason ? (
          <TextAreaField label="Why is this still appropriate?" name="override_reason" id="override_reason" defaultValue={v("override_reason")} rows={3}
            hint={`At least ${MIN_OVERRIDE_REASON_LENGTH} characters. Saved with the prescription and shown to the pharmacist.`} error={state.reasonError} />
        ) : (
          <input type="hidden" name="override_reason" value="" />
        )}

        <details>
          <summary className="cursor-pointer text-sm font-bold text-brand-700">Classify this medicine by hand</summary>
          <div className="mt-2 max-w-sm">
            <SelectField label="Drug class" name="drug_class" id="drug_class" optional value={manual} onChange={(ev) => setManual(ev.currentTarget.value)}
              hint="Use for a medicine the list doesn't know, so the allergy check can run.">
              <option value="">Detect automatically</option>
              {DRUG_CLASSES.map((c) => <option key={c} value={c}>{DRUG_CLASS_LABEL[c]}</option>)}
            </SelectField>
          </div>
        </details>
      </section>

      <div className="flex gap-3">
        <SubmitButton pendingLabel="Prescribing…">{typed && check.requiresReason ? "Prescribe with reason" : "Prescribe"}</SubmitButton>
        <Link href={`/doctor/notes/${consultationId}`} className="inline-flex min-h-touch items-center px-3 font-bold">Cancel</Link>
      </div>
    </form>
  );
}
