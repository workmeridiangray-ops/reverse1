'use client';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export type FormState = { ok?: boolean; error?: string; message?: string; code?: string; redirect?: string } | null;
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/**
 * Every form in the app goes through this: pending state (no double submit), a per-render idempotency key,
 * success/error banners, expired-session recovery, and a warning before leaving with unsaved edits.
 */
export default function ActionForm({ action, children, submit = 'Save', submitClass = 'btn btn-primary', className = '', resetOnSuccess = false, secondary }:
  { action: Action; children: ReactNode; submit?: string; submitClass?: string; className?: string; resetOnSuccess?: boolean; secondary?: ReactNode }) {
  const [state, run, pending] = useActionState(action, null);
  const [dirty, setDirty] = useState(false);
  const [idem, setIdem] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random())));
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  useEffect(() => {
    if (state?.ok) {
      setDirty(false); setIdem(crypto.randomUUID());
      if (resetOnSuccess) ref.current?.reset();
      if (state.redirect) router.push(state.redirect); else router.refresh();
    }
    if (state?.code === 'expired') router.push('/login?expired=1');
  }, [state, resetOnSuccess, router]);

  return (
    <form ref={ref} action={run} onChange={() => setDirty(true)} className={`space-y-4 ${className}`} noValidate={false}>
      <input type="hidden" name="_idem" value={idem} />
      {children}
      <div aria-live="polite" className="space-y-2">
        {state?.error && <div role="alert" className="rounded border border-[#efc0c0] bg-bad-soft px-4 py-3 text-sm"><strong>Not saved.</strong> {state.error}{state.code === 'duplicate' ? '' : ' Your entries are still here — fix the issue and try again.'}</div>}
        {state?.ok && state.message && <div role="status" className="rounded border border-[#b9dcc5] bg-ok-soft px-4 py-3 text-sm">{state.message}</div>}
        {dirty && !pending && !state?.ok && <p className="text-xs text-muted">You have unsaved changes.</p>}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="submit" disabled={pending} className={submitClass}>{pending ? 'Working…' : submit}</button>
        {secondary}
      </div>
    </form>
  );
}

/** Small inline confirm for destructive or irreversible actions. */
export function ConfirmButton({ action, label, confirmText, className = 'btn btn-sm', hidden = {} }: { action: Action; label: string; confirmText: string; className?: string; hidden?: Record<string, string> }) {
  const [state, run, pending] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); if (state?.code === 'expired') router.push('/login?expired=1'); }, [state, router]);
  return (
    <form action={run} onSubmit={e => { if (!confirm(confirmText)) e.preventDefault(); }} className="inline">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pending} className={className}>{pending ? '…' : label}</button>
      {state?.error && <span role="alert" className="block text-xs text-bad mt-1 max-w-xs">{state.error}</span>}
    </form>
  );
}

/** Action that needs a typed reason (rejections, corrections, financial changes). */
export function ReasonForm({ action, label, reasonLabel = 'Reason', hidden = {}, danger = false, placeholder }: { action: Action; label: string; reasonLabel?: string; hidden?: Record<string, string>; danger?: boolean; placeholder?: string }) {
  const [state, run, pending] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { setOpen(false); router.refresh(); } if (state?.code === 'expired') router.push('/login?expired=1'); }, [state, router]);
  if (!open) return <button type="button" className={`btn btn-sm ${danger ? 'text-bad' : ''}`} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form action={run} className="card p-3 space-y-2 max-w-md">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="label" htmlFor={`r-${label}`}>{reasonLabel}</label>
      <textarea id={`r-${label}`} name="reason" required minLength={3} rows={2} className="input" placeholder={placeholder} />
      {state?.error && <p role="alert" className="text-xs text-bad">{state.error}</p>}
      <div className="flex gap-2"><button disabled={pending} className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}>{pending ? '…' : label}</button><button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
