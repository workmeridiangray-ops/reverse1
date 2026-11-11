import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { orderLabs } from "@/app/(app)/doctor/clinical-actions";

export function OrderLabsForm({ tests, patientId, consultationId, backPath }: {
  tests: Array<{ id: string; code: string; name: string; unit: string }>; patientId: string; consultationId: string; backPath: string;
}) {
  if (tests.length === 0) return <p className="text-ink-500">No tests are set up for this clinic yet.</p>;
  return (
    <form action={orderLabs} className="flex flex-col gap-4">
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="consultation_id" value={consultationId} />
      <input type="hidden" name="back" value={backPath} />
      <fieldset>
        <legend className="mb-2 font-bold">Tests to order</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {tests.map((t) => (
            <label key={t.id} className="flex min-h-touch cursor-pointer items-center gap-3 rounded border border-line px-3 hover:bg-canvas">
              <input type="checkbox" name="test_id" value={t.id} className="h-5 w-5 accent-brand-700" />
              <span><span className="font-bold">{t.name}</span> <span className="text-sm text-ink-500">({t.unit})</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextField label="Note for the laboratory" name="notes" id="lab_notes" optional maxLength={500} />
      <div><Button type="submit" variant="primary" icon="plus">Order tests</Button></div>
    </form>
  );
}
