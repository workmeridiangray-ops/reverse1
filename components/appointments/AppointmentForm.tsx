"use client";
import Link from "next/link";
import { useActionState } from "react";
import { saveAppointment, type AppointmentFormState } from "@/app/(app)/appointments/actions";
import { CheckboxField, SelectField, TextField } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";

interface Option { id: string; label: string; disabled?: boolean }
export interface AppointmentFormProps {
  initial: { id?: string; requestId?: string; patient_id: string; doctor_id: string; room_id: string; date: string; time: string; duration: string; reason: string };
  patients: Option[];
  doctors: Option[];
  rooms: Option[];
  timeZone: string;
}

const DURATIONS = [10, 15, 20, 30, 45, 60, 90];

export function AppointmentForm({ initial, patients, doctors, rooms, timeZone }: AppointmentFormProps) {
  const [state, action] = useActionState<AppointmentFormState, FormData>(saveAppointment, {});
  const v = (k: keyof AppointmentFormProps["initial"]) => state.values?.[k] ?? initial[k] ?? "";
  const e = state.errors ?? {};
  const blocking = state.issues?.filter((i) => i.severity === "blocking") ?? [];
  const warnings = state.issues?.filter((i) => i.severity === "warning") ?? [];
  // Re-mount fields when the server returns values so defaults update.
  const key = JSON.stringify(state.values ?? {});
  return (
    <form action={action} className="flex max-w-3xl flex-col gap-6" key={key} noValidate>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.requestId ? <input type="hidden" name="request_id" value={initial.requestId} /> : null}
      {state.formError ? <Alert tone="danger" title="Not saved">{state.formError}</Alert> : null}
      {blocking.length ? (
        <Alert tone="danger" title="This time doesn't work">
          <ul className="list-disc pl-5">{blocking.map((i) => <li key={i.code + (i.conflictingId ?? "")}>{i.message}</li>)}</ul>
        </Alert>
      ) : null}
      {warnings.length && !blocking.length ? (
        <Alert tone="warn" title="Please check">
          <ul className="list-disc pl-5">{warnings.map((i) => <li key={i.code + (i.conflictingId ?? "")}>{i.message}</li>)}</ul>
        </Alert>
      ) : null}

      <SelectField label="Patient" name="patient_id" defaultValue={v("patient_id")} error={e.patient_id}>
        <option value="">Choose a patient…</option>
        {patients.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </SelectField>
      <div className="grid gap-5 md:grid-cols-2">
        <SelectField label="Doctor" name="doctor_id" defaultValue={v("doctor_id")} error={e.doctor_id}>
          <option value="">Choose a doctor…</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </SelectField>
        <SelectField label="Room" name="room_id" defaultValue={v("room_id")} optional hint="Can be chosen at check-in.">
          <option value="">Decide later</option>
          {rooms.map((r) => <option key={r.id} value={r.id} disabled={r.disabled}>{r.label}</option>)}
        </SelectField>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <TextField label="Date" name="date" type="date" defaultValue={v("date")} error={e.date} />
        <TextField label="Start time" name="time" type="time" step={300} defaultValue={v("time")} error={e.time} hint={`Clinic time (${timeZone})`} />
        <SelectField label="Length" name="duration" defaultValue={v("duration") || "20"} error={e.duration}>
          {DURATIONS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </SelectField>
      </div>
      <TextField label="Reason for visit" name="reason" optional defaultValue={v("reason")} maxLength={500} />
      {state.needsConfirm ? <CheckboxField label="I've checked the warning above. Book anyway." name="confirm" /> : null}
      <div className="flex gap-3">
        <SubmitButton>{initial.id ? "Save changes" : "Book appointment"}</SubmitButton>
        <Link href={initial.id ? `/appointments/${initial.id}` : "/appointments"} className="inline-flex min-h-touch items-center px-3 font-bold">Cancel</Link>
      </div>
    </form>
  );
}
