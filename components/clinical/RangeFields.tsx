import { SelectField, TextField } from "@/components/ui/Field";

interface Initial { sex: string; ageMin: number; ageMax: number; low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null; note: string | null }
const v = (n: number | null) => (n === null ? "" : String(n));

/** The fields of a reference range. `idp` keeps element ids unique when many forms share a page. */
export function RangeFields({ idp, initial }: { idp: string; initial?: Initial }) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <SelectField label="Applies to" name="sex" id={`${idp}-sex`} defaultValue={initial?.sex ?? "any"}>
        <option value="any">Any sex</option><option value="female">Women</option><option value="male">Men</option>
      </SelectField>
      <TextField label="From age (years)" name="age_min" id={`${idp}-amin`} inputMode="numeric" defaultValue={String(initial?.ageMin ?? 0)} />
      <TextField label="Up to age (years)" name="age_max" id={`${idp}-amax`} inputMode="numeric" optional defaultValue={initial && initial.ageMax < 200 ? String(initial.ageMax) : ""} hint="Blank = no upper limit. Not included." />
      <div />
      <TextField label="Critical below" name="critical_low" id={`${idp}-cl`} inputMode="decimal" optional defaultValue={v(initial?.criticalLow ?? null)} />
      <TextField label="Normal from" name="low" id={`${idp}-lo`} inputMode="decimal" optional defaultValue={v(initial?.low ?? null)} />
      <TextField label="Normal up to" name="high" id={`${idp}-hi`} inputMode="decimal" optional defaultValue={v(initial?.high ?? null)} />
      <TextField label="Critical above" name="critical_high" id={`${idp}-ch`} inputMode="decimal" optional defaultValue={v(initial?.criticalHigh ?? null)} />
      <div className="md:col-span-4"><TextField label="Source or note" name="note" id={`${idp}-note`} optional maxLength={200} defaultValue={initial?.note ?? ""} hint="Where these numbers came from, e.g. the laboratory's handbook. Editing the note does not clear a sign-off." /></div>
    </div>
  );
}
