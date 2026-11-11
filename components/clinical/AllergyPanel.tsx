import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TextField, SelectField } from "@/components/ui/Field";
import { Alert, Card } from "@/components/ui/Layout";
import { addAllergy, confirmNoKnownAllergies, removeAllergy } from "@/app/(app)/doctor/clinical-actions";
import { type AllergyRecord, allergyRecordState } from "@/lib/rules/allergy";
import type { StatusVisual } from "@/lib/ui/status";

const SEVERITY: Record<string, StatusVisual> = {
  mild: { tone: "neutral", icon: "alert", label: "Mild" },
  moderate: { tone: "warn", icon: "alert", label: "Moderate" },
  severe: { tone: "danger", icon: "alert", label: "Severe" },
};

export function AllergyPanel({ patientId, allergies, backPath, editable = true, compactTitle = false }: {
  patientId: string; allergies: AllergyRecord[]; backPath: string; editable?: boolean; compactTitle?: boolean;
}) {
  const state = allergyRecordState(allergies);
  const live = allergies.filter((a) => a.kind === "allergy");
  return (
    <Card title={compactTitle ? "Allergies" : "Allergies and reactions"} as="aside">
      {state === "not_recorded" ? (
        <Alert tone="warn" title="Allergy status not recorded">
          Nothing has been recorded, which is not the same as no allergies. Ask the patient, then record it.
          {editable ? (
            <form action={confirmNoKnownAllergies} className="mt-3">
              <input type="hidden" name="patient_id" value={patientId} />
              <input type="hidden" name="back" value={backPath} />
              <Button type="submit" size="sm" variant="secondary" icon="check">Confirm no known drug allergies</Button>
            </form>
          ) : null}
        </Alert>
      ) : null}
      {state === "no_known_allergies" ? (
        <p className="flex items-center gap-2 font-bold text-ok-fg"><Badge visual={{ tone: "ok", icon: "shield", label: "No known drug allergies" }} size="sm" /></p>
      ) : null}
      {live.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {live.map((a) => (
            <li key={a.id} className="rounded border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-bold">{a.allergen}</p>
                {a.severity ? <Badge visual={SEVERITY[a.severity]!} size="sm" /> : null}
              </div>
              {a.reaction ? <p className="text-sm text-ink-700">{a.reaction}</p> : null}
              {!a.allergenClass ? <p className="mt-1 text-caption text-ink-500">Recorded, but not a drug class the system can match automatically. Check by hand.</p> : null}
              {editable ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-bold text-brand-700">Remove</summary>
                  <form action={removeAllergy} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="back" value={backPath} />
                    <TextField label="Why is it being removed?" name="reason" id={`rm-${a.id}`} maxLength={200} />
                    <div><Button type="submit" size="sm" variant="danger">Remove {a.allergen}</Button></div>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {editable ? (
        <details className="mt-4 border-t border-line pt-4" open={state === "not_recorded" ? false : undefined}>
          <summary className="cursor-pointer font-bold text-brand-700">Add an allergy</summary>
          <form action={addAllergy} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="patient_id" value={patientId} />
            <input type="hidden" name="back" value={backPath} />
            <TextField label="Allergic to" name="allergen" id="allergen" maxLength={120} hint="A drug or class, e.g. penicillin, sulfa, ibuprofen" />
            <SelectField label="Severity" name="severity" id="allergy_severity" defaultValue="">
              <option value="" disabled>Choose…</option>
              <option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option>
            </SelectField>
            <TextField label="Reaction" name="reaction" id="allergy_reaction" optional maxLength={200} />
            <div><Button type="submit" variant="secondary" icon="plus">Record allergy</Button></div>
          </form>
        </details>
      ) : null}
    </Card>
  );
}
