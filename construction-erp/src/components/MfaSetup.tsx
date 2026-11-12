'use client';
import { useState } from 'react';
import ActionForm from './ActionForm';
import { startMfaAction, enableMfaAction } from '@/app/actions/auth';
export default function MfaSetup() {
  const [sec, setSec] = useState<{ secret: string; uri: string } | null>(null);
  if (!sec) return <div><p className="text-sm text-muted mb-3">Add a second step using an authenticator app.</p><button className="btn btn-primary" onClick={async () => setSec(await startMfaAction())}>Set up two-factor</button></div>;
  return <ActionForm action={enableMfaAction} submit="Turn on"><p className="text-sm">In your authenticator app add a time-based account manually with this key:</p><p className="font-mono text-lg break-all">{sec.secret}</p><div><label className="label" htmlFor="code">6-digit code</label><input id="code" name="code" inputMode="numeric" maxLength={6} className="input" required /></div></ActionForm>;
}
