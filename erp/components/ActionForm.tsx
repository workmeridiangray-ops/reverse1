"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
const newToken = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));

/**
 * Form wrapper: pending state, field + form errors, success message, duplicate-submission token,
 * and a warning if the user tries to leave with unsaved edits.
 */
export function ActionForm({ action, children, submit = "Save", danger, confirm, className, resetOnSuccess, secondary, guard = true }: {
  action: Action; children: ReactNode; submit?: string; danger?: boolean; confirm?: string; className?: string; resetOnSuccess?: boolean; secondary?: ReactNode; guard?: boolean;
}) {
  const [state, run, pending] = useActionState<ActionResult | null, FormData>(async (p, f) => action(p, f), null);
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [token, setToken] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => setToken(newToken()), []);
  useEffect(() => {
    if (!dirty || !guard) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty, guard]);
  useEffect(() => {
    if (state?.ok) {
      setDirty(false); setToken(newToken());
      if (resetOnSuccess) ref.current?.reset();
      if (state.redirectTo) router.push(state.redirectTo); else router.refresh();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const errs = state && !state.ok ? state.fields ?? {} : {};
  useEffect(() => {
    const f = ref.current; if (!f) return;
    f.querySelectorAll("[data-err]").forEach((el) => el.remove());
    f.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    for (const [k, msg] of Object.entries(errs)) {
      const el = f.querySelector<HTMLElement>(`[name="${k}"]`); if (!el) continue;
      el.setAttribute("aria-invalid", "true");
      const d = document.createElement("div"); d.className = "err"; d.dataset.err = "1"; d.textContent = msg; el.insertAdjacentElement("afterend", d);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form ref={ref} action={run} className={className} onChange={() => setDirty(true)}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="_token" value={token} />
      {state && !state.ok && <div className="alert bad" role="alert">{state.error}</div>}
      {state?.ok && state.message && <div className="alert ok" role="status">{state.message}</div>}
      {children}
      <div className="row" style={{ marginTop: 16 }}>
        <button className={`btn ${danger ? "danger" : "primary"}`} type="submit" disabled={pending || !token} aria-busy={pending}>{pending ? "Working…" : submit}</button>
        {secondary}
      </div>
    </form>
  );
}

export function Field({ name, label, type = "text", defaultValue, required, hint, placeholder, children, step, min, max, autoComplete, rows }: {
  name: string; label: string; type?: string; defaultValue?: string | number | null; required?: boolean; hint?: string; placeholder?: string; children?: ReactNode; step?: string; min?: string; max?: string; autoComplete?: string; rows?: number;
}) {
  const id = `f_${name}`;
  return (
    <div className="field">
      <label className="f" htmlFor={id}>{label}{required && <span aria-hidden> *</span>}</label>
      {type === "select" ? <select id={id} name={name} required={required} defaultValue={defaultValue ?? ""}>{children}</select>
        : type === "textarea" ? <textarea id={id} name={name} required={required} defaultValue={defaultValue ?? ""} placeholder={placeholder} rows={rows} />
        : <input id={id} name={name} type={type} required={required} defaultValue={defaultValue ?? ""} placeholder={placeholder} step={step} min={min} max={max} autoComplete={autoComplete} inputMode={type === "number" ? "decimal" : undefined} />}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
