"use client";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/Layout";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveNote, type NoteState } from "../../actions";

interface Props {
  id: string;
  signed: boolean;
  note: { subjective: string; objective: string; assessment: string; plan: string; isCritical: boolean; criticalReason: string | null };
}

export function NoteForm({ id, signed, note }: Props) {
  const [state, action] = useActionState<NoteState, FormData>(saveNote, {});
  const [critical, setCritical] = useState(note.isCritical);
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="signed" value={String(signed)} />
      {state.errors?.length ? (
        <Alert tone="danger" title="Not saved">
          <ul className="list-disc pl-5">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Alert>
      ) : state.saved ? <Alert tone="ok" title="Saved" /> : null}

      {signed ? null : (
        <>
          <TextAreaField label="Subjective" name="subjective" defaultValue={note.subjective} optional hint="What the patient reports." rows={4} />
          <TextAreaField label="Objective" name="objective" defaultValue={note.objective} optional hint="Examination and observations." rows={4} />
          <TextAreaField label="Assessment" name="assessment" defaultValue={note.assessment} optional rows={3} />
          <TextAreaField label="Plan" name="plan" defaultValue={note.plan} optional rows={3} hint="An assessment or a plan is required to sign." />
        </>
      )}

      <fieldset className="rounded border border-line p-4">
        <legend className="px-1 font-bold">Priority</legend>
        <CheckboxField label="Mark as critical" name="is_critical" checked={critical} onChange={(e) => setCritical(e.currentTarget.checked)}
          hint="Pins this patient to the top of your list until you clear it." />
        {critical ? (
          <div className="mt-4">
            <TextField label="Why is this critical?" name="critical_reason" defaultValue={note.criticalReason ?? ""} maxLength={200} />
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <SubmitButton name="intent" value="save" variant="secondary">{signed ? "Update priority" : "Save draft"}</SubmitButton>
        {signed ? null : <SubmitButton name="intent" value="sign" pendingLabel="Signing…" icon="lock">Sign note</SubmitButton>}
      </div>
      {signed ? null : <p className="text-sm text-ink-500">Signing locks the clinical text. It cannot be edited afterwards.</p>}
    </form>
  );
}
