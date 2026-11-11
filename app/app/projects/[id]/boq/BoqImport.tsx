"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui/Layout";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { type FormEvent, startTransition, useEffect, useState } from "react";
import { importBoq } from "./actions";

export function BoqImport({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(importBoq, null);
  const router = useRouter();
  const [rid, setRid] = useState("");
  useEffect(() => setRid(crypto.randomUUID()), []);
  useEffect(() => { if (state?.ok && state.message?.startsWith("Imported")) { setRid(crypto.randomUUID()); router.refresh(); } }, [state, router]);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(fd));
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="request_id" value={rid} />
      <label htmlFor="boqfile" className="text-sm font-bold">CSV file <span className="font-normal text-ink-500">columns: code, description, unit, quantity, rate (₹ per unit)</span></label>
      <input id="boqfile" name="file" type="file" accept=".csv,text/csv" required className="min-h-touch rounded border border-ink-500 bg-surface p-2" />
      <div aria-live="polite">
        {state?.error ? <Alert tone="danger" title={state.error}>{state.details ? <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5">{state.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}</Alert> : null}
        {state?.ok ? <Alert tone="ok" title={state.message} /> : null}
      </div>
      <div className="flex gap-3">
        <Button type="submit" name="mode" value="preview" variant="secondary" disabled={pending}>Validate only</Button>
        <Button type="submit" name="mode" value="commit" disabled={pending}>{pending ? "Working…" : "Validate and import"}</Button>
      </div>
    </form>
  );
}
