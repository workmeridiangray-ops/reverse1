"use client";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { FormState } from "@/lib/server/action";

type Props = { action: (p: FormState, fd: FormData) => Promise<FormState>; children: ReactNode; submit: string; danger?: boolean; confirm?: string; className?: string; resetOnOk?: boolean; secondary?: boolean; small?: boolean };
/** Pending state, double-submit guard, inline error/success, and an unsaved-changes warning. */
export function ActionForm({ action, children, submit, danger, confirm: confirmText, className, resetOnOk, secondary, small }: Props) {
  const [state, run, pending] = useActionState(action, null);
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  useEffect(() => { if (state?.ok) { setDirty(false); if (resetOnOk) ref.current?.reset(); } }, [state, resetOnOk]);
  return (
    // Submit through a transition instead of the form `action` prop: React would otherwise reset every field after a failed
    // submission and wipe the user's input. Fields are only reset after success (resetOnOk).
    <form ref={ref} onChange={() => setDirty(true)} className={className}
      onSubmit={(e) => { e.preventDefault(); if (pending) return; if (confirmText && !window.confirm(confirmText)) return; const fd = new FormData(e.currentTarget); startTransition(() => run(fd)); }}>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${danger ? "btn-danger" : secondary ? "btn-secondary" : "btn-primary"} ${small ? "btn-sm" : ""}`} aria-busy={pending}>
          {pending ? "Saving…" : submit}
        </button>
        <div aria-live="polite" role="status" className="text-sm">
          {state?.error && <span className="text-danger" role="alert">⚠ {state.error}</span>}
          {state?.ok && !pending && <span className="text-ok">✓ {state.ok}</span>}
        </div>
      </div>
    </form>
  );
}
