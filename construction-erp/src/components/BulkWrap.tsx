'use client';
import { useActionState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { FormState } from './ActionForm';

/** Wraps a table of checkboxes with a deliberate, confirmed bulk action. */
export default function BulkWrap({ enabled, action, children }: { enabled: boolean; action: (p: FormState, fd: FormData) => Promise<FormState>; children: ReactNode }) {
  const [state, run, pending] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  if (!enabled) return <>{children}</>;
  return (
    <form action={run} onSubmit={e => { if (!confirm('Delete the selected draft records? This cannot be undone.')) e.preventDefault(); }}>
      {children}
      <div className="flex items-center gap-3 mt-3">
        <button disabled={pending} className="btn btn-sm text-bad">{pending ? 'Deleting…' : 'Delete selected drafts'}</button>
        {state?.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
        {state?.ok && <span role="status" className="text-sm text-ok">{state.message}</span>}
      </div>
    </form>
  );
}
