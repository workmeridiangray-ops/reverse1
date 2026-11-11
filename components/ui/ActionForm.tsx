"use client";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { Alert } from "./Layout";
import { Button } from "./Button";
import type { FormState } from "@/lib/server/actions";

/**
 * Form wired to a server action. Shows validation / success / failure inline,
 * sends a one-time request id (duplicate submissions are ignored server-side),
 * and warns before leaving with unsaved edits.
 */
export function ActionForm({
  action, children, submitLabel = "Save", pendingLabel = "Saving…", variant = "primary", reset = false, className = "", footer, danger,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode; submitLabel?: string; pendingLabel?: string; variant?: "primary" | "secondary" | "danger";
  reset?: boolean; className?: string; footer?: ReactNode; danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [rid, setRid] = useState("");
  const errId = useId();
  useEffect(() => setRid(crypto.randomUUID()), []);
  // Submit through a transition instead of the form `action` prop so React does not wipe the user's input after a failed save.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  }
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      setDirty(false);
      setRid(crypto.randomUUID());
      if (state.message) window.dispatchEvent(new CustomEvent("app:toast", { detail: state.message }));
      if (reset) ref.current?.reset();
      if (state.redirectTo) router.push(state.redirectTo); else router.refresh();
    }
    if (state.fieldErrors) {
      // surface per-field errors next to the control
      for (const [k, v] of Object.entries(state.fieldErrors)) {
        const el = ref.current?.elements.namedItem(k);
        if (el instanceof HTMLElement && "setCustomValidity" in el) el.setAttribute("aria-invalid", "true");
        void v;
      }
    }
  }, [state, reset, router]);
  return (
    <form ref={ref} onSubmit={onSubmit} onChange={() => setDirty(true)} className={`flex flex-col gap-4 ${className}`}>
      <input type="hidden" name="request_id" value={rid} />
      {children}
      <div aria-live="polite" id={errId}>
        {state?.error ? (
          <Alert tone="danger" title={state.error}>
            {state.details ? <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5">{state.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}
            {state.fieldErrors ? <ul className="list-disc pl-5">{Object.entries(state.fieldErrors).filter(([, v]) => v !== state.error).map(([k, v]) => <li key={k}>{v}</li>)}</ul> : null}
          </Alert>
        ) : null}
        {state?.ok && state.message ? <Alert tone="ok" title={state.message}>{state.details ? <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5">{state.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}</Alert> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-disabled={pending} variant={danger ? "danger" : variant}>{pending ? pendingLabel : submitLabel}</Button>
        {footer}
      </div>
    </form>
  );
}
